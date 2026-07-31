import * as turf from '@turf/turf';
import { Prisma, SegmentMatchSource, TripAnalysisStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  findNearestMatchedEdge,
  MapMatchingError,
  matchTrace,
  type MatchedEdge,
} from '@/lib/map-matching';
import { calculateBoundingBox } from '@/lib/segment-matching';
import { analyzeDirections } from '@/lib/trip-directions';
import { runCongestionAnalysis, type CongestionAnalysisResult } from '@/lib/post-processing';
import { findMatchingRouteTemplate } from '@/lib/route-template-matching';

const PROCESSING_STALE_MS = 5 * 60 * 1_000;

export class AnalysisBusyError extends Error {
  constructor() {
    super('Trip analysis is already processing');
    this.name = 'AnalysisBusyError';
  }
}

export class RetryableAnalysisError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message || code);
    this.name = 'RetryableAnalysisError';
  }
}

export interface TripAnalysisOutcome {
  status: TripAnalysisStatus;
  coverage: number;
  confidence: number | null;
  matchedDistance: number | null;
  maneuverCount: number;
  retryable: boolean;
}

export interface DriveAnalysisOutcome {
  tripAnalysis: TripAnalysisOutcome;
  congestion: CongestionAnalysisResult | null;
}

async function claimAnalysis(driveId: string) {
  const existing = await prisma.tripAnalysis.findUnique({ where: { driveId } });
  if (existing?.status === 'COMPLETED' || existing?.status === 'PARTIAL') {
    return { analysis: existing, claimed: false };
  }
  if (existing?.status === 'PROCESSING' &&
      existing.updatedAt.getTime() > Date.now() - PROCESSING_STALE_MS) {
    throw new AnalysisBusyError();
  }

  if (!existing) {
    try {
      const analysis = await prisma.tripAnalysis.create({
        data: { driveId, status: 'PROCESSING', startedAt: new Date() },
      });
      return { analysis, claimed: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AnalysisBusyError();
      }
      throw error;
    }
  }

  const result = await prisma.tripAnalysis.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: 'FAILED' },
        { status: 'PROCESSING', updatedAt: { lte: new Date(Date.now() - PROCESSING_STALE_MS) } },
      ],
    },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
    },
  });
  if (result.count !== 1) throw new AnalysisBusyError();
  return {
    analysis: await prisma.tripAnalysis.findUniqueOrThrow({ where: { id: existing.id } }),
    claimed: true,
  };
}

function sanitizeMessage(message: string): string {
  return message.replace(/pk\.[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 240);
}

function segmentBearingAt(
  point: [number, number],
  geometry: GeoJSON.LineString
): number | null {
  if (geometry.coordinates.length < 2) return null;
  const line = turf.lineString(geometry.coordinates);
  const snapped = turf.nearestPointOnLine(line, turf.point(point), { units: 'meters' });
  const index = Math.min(
    geometry.coordinates.length - 2,
    Math.max(0, Number(snapped.properties.index ?? 0))
  );
  return turf.bearing(
    turf.point(geometry.coordinates[index]),
    turf.point(geometry.coordinates[index + 1])
  );
}

function bearingCompatible(heading: number | null, segmentBearing: number | null): boolean {
  if (heading == null || segmentBearing == null) return true;
  const delta = Math.abs(((heading - segmentBearing + 540) % 360) - 180);
  return delta <= 45 || Math.abs(delta - 180) <= 45;
}

function findManualMatch(
  latitude: number,
  longitude: number,
  heading: number | null,
  segments: Array<{ id: string; geometry: Prisma.JsonValue }>,
  threshold: number
): { segmentId: string; distance: number; position: number } | null {
  const point = turf.point([longitude, latitude]);
  let best: { segmentId: string; distance: number; position: number } | null = null;
  for (const segment of segments) {
    const geometry = segment.geometry as unknown as GeoJSON.LineString;
    if (!geometry?.coordinates || geometry.coordinates.length < 2) continue;
    const line = turf.lineString(geometry.coordinates);
    const snapped = turf.nearestPointOnLine(line, point, { units: 'meters' });
    const distance = Number(snapped.properties.dist ?? Number.POSITIVE_INFINITY);
    if (distance > threshold || !bearingCompatible(heading, segmentBearingAt([longitude, latitude], geometry))) {
      continue;
    }
    const length = turf.length(line, { units: 'kilometers' });
    const position = length > 0 ? Number(snapped.properties.location ?? 0) / length : 0;
    if (!best || distance < best.distance) {
      best = { segmentId: segment.id, distance, position: Math.max(0, Math.min(1, position)) };
    }
  }
  return best;
}

async function upsertEdges(edges: MatchedEdge[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const edge of edges) {
    const bounds = calculateBoundingBox(edge.geometry);
    const segment = await prisma.roadSegment.upsert({
      where: { source_sourceId: { source: 'MAPBOX', sourceId: edge.sourceId } },
      create: {
        name: edge.name,
        geometry: edge.geometry as unknown as Prisma.InputJsonValue,
        ...bounds,
        source: 'MAPBOX',
        sourceId: edge.sourceId,
      },
      update: {
        name: edge.name,
        geometry: edge.geometry as unknown as Prisma.InputJsonValue,
        ...bounds,
        isActive: true,
      },
      select: { id: true },
    });
    result.set(edge.sourceId, segment.id);
  }
  return result;
}

export async function runTripAnalysis(driveId: string): Promise<TripAnalysisOutcome> {
  const { analysis, claimed } = await claimAnalysis(driveId);
  if (!claimed) {
    return {
      status: analysis.status,
      coverage: analysis.coverage,
      confidence: analysis.confidence,
      matchedDistance: analysis.matchedDistance,
      maneuverCount: await prisma.maneuver.count({ where: { tripAnalysisId: analysis.id } }),
      retryable: false,
    };
  }

  const gpsSamples = await prisma.gpsSample.findMany({
    where: { driveId },
    orderBy: { timestamp: 'asc' },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      timestamp: true,
      accuracy: true,
      heading: true,
      speed: true,
    },
  });

  try {
    const result = await matchTrace(gpsSamples);
    const [edgeIds, manualSegments] = await Promise.all([
      upsertEdges(result.edges),
      prisma.roadSegment.findMany({
        where: { source: 'MANUAL', isActive: true },
        select: { id: true, geometry: true },
      }),
    ]);
    const pointConfidence = new Map(result.points.map((point) => [point.gpsId, point.confidence]));
    const matches: Array<{
      gpsId: string;
      segmentId: string;
      distance: number;
      position: number;
      snappedLatitude: number | null;
      snappedLongitude: number | null;
      confidence: number | null;
      source: SegmentMatchSource;
    }> = [];

    for (const sample of gpsSamples) {
      const manualOverride = findManualMatch(
        sample.latitude, sample.longitude, sample.heading, manualSegments, 30
      );
      if (manualOverride) {
        matches.push({
          gpsId: sample.id,
          segmentId: manualOverride.segmentId,
          distance: manualOverride.distance,
          position: manualOverride.position,
          snappedLatitude: null,
          snappedLongitude: null,
          confidence: 1,
          source: 'MANUAL_OVERRIDE',
        });
        continue;
      }

      const nearest = findNearestMatchedEdge(
        [sample.longitude, sample.latitude],
        result.edges
      );
      const automaticSegmentId = nearest ? edgeIds.get(nearest.edge.sourceId) : undefined;
      if (nearest && automaticSegmentId && nearest.distance <= 50) {
        const snapped = turf.nearestPointOnLine(
          turf.lineString(nearest.edge.geometry.coordinates),
          turf.point([sample.longitude, sample.latitude]),
          { units: 'meters' }
        );
        matches.push({
          gpsId: sample.id,
          segmentId: automaticSegmentId,
          distance: nearest.distance,
          position: nearest.position,
          snappedLatitude: snapped.geometry.coordinates[1],
          snappedLongitude: snapped.geometry.coordinates[0],
          confidence: pointConfidence.get(sample.id) ?? nearest.edge.confidence,
          source: 'MAPBOX',
        });
        continue;
      }

      const manualFallback = findManualMatch(
        sample.latitude, sample.longitude, sample.heading, manualSegments, 50
      );
      if (manualFallback) {
        matches.push({
          gpsId: sample.id,
          segmentId: manualFallback.segmentId,
          distance: manualFallback.distance,
          position: manualFallback.position,
          snappedLatitude: null,
          snappedLongitude: null,
          confidence: 0.5,
          source: 'MANUAL_FALLBACK',
        });
      }
    }

    const directions = analyzeDirections(result.geometry);
    const observedSpeeds = gpsSamples.flatMap((sample) => sample.speed == null ? [] : [sample.speed]);
    const observedAverage = observedSpeeds.length
      ? observedSpeeds.reduce((sum, speed) => sum + speed, 0) / observedSpeeds.length
      : null;
    const speedRatio = observedAverage != null && result.trafficContext.speedLimitAverage
      ? observedAverage / result.trafficContext.speedLimitAverage
      : null;
    const roadCondition = speedRatio == null ? 'INSUFFICIENT_CONTEXT'
      : speedRatio >= 0.75 ? 'NORMAL_FOR_ROAD'
        : speedRatio >= 0.45 ? 'SLOW_FOR_ROAD'
          : 'LOW_FOR_ROAD';
    const trafficContext = {
      ...result.trafficContext,
      observedAverageSpeed: observedAverage,
      observedSpeedRatio: speedRatio,
      roadCondition,
      snapshotOnly: true,
    };
    const templates = await prisma.routeTemplate.findMany({
      where: { isActive: true },
      select: { id: true, geometry: true, distance: true, direction: true },
    });
    const routeTemplateId = findMatchingRouteTemplate(result.geometry, result.distance, directions.dominantDirection, templates);
    const finalStatus: TripAnalysisStatus = result.partial ? 'PARTIAL' : 'COMPLETED';
    await prisma.$transaction([
      prisma.gpsSegmentMatch.deleteMany({ where: { gps: { driveId } } }),
      prisma.maneuver.deleteMany({ where: { tripAnalysisId: analysis.id } }),
      prisma.gpsSegmentMatch.createMany({ data: matches, skipDuplicates: true }),
      prisma.maneuver.createMany({
        data: result.maneuvers.map((maneuver, sequence) => ({
          tripAnalysisId: analysis.id,
          sequence,
          ...maneuver,
        })),
      }),
      prisma.drive.update({ where: { id: driveId }, data: { routeTemplateId } }),
      prisma.tripAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: finalStatus,
          matchedGeometry: result.geometry as unknown as Prisma.InputJsonValue,
          matchedDistance: result.distance,
          confidence: result.confidence,
          coverage: result.coverage,
          matchedPointCount: result.matchedPointCount,
          totalPointCount: result.totalPointCount,
          netDirection: directions.netDirection,
          dominantDirection: directions.dominantDirection,
          directionBreakdown: directions.directionBreakdown as unknown as Prisma.InputJsonValue,
          trafficContext: trafficContext as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          errorCode: result.partial ? 'PARTIAL_COVERAGE' : null,
          errorMessage: null,
        },
      }),
    ]);

    return {
      status: finalStatus,
      coverage: result.coverage,
      confidence: result.confidence,
      matchedDistance: result.distance,
      maneuverCount: result.maneuvers.length,
      retryable: false,
    };
  } catch (error) {
    const mapError = error instanceof MapMatchingError
      ? error
      : new MapMatchingError('ANALYSIS_ERROR', true, error instanceof Error ? error.message : undefined);
    await prisma.tripAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: 'FAILED',
        errorCode: mapError.code,
        errorMessage: sanitizeMessage(mapError.message),
        completedAt: new Date(),
      },
    });
    if (mapError.retryable) throw new RetryableAnalysisError(mapError.code, mapError.message);
    return {
      status: 'FAILED',
      coverage: 0,
      confidence: null,
      matchedDistance: null,
      maneuverCount: 0,
      retryable: false,
    };
  }
}

export async function runDriveAnalysis(driveId: string): Promise<DriveAnalysisOutcome> {
  const [drive, tripAnalysis] = await Promise.all([
    prisma.drive.findUniqueOrThrow({
      where: { id: driveId },
      select: { recordingMode: true },
    }),
    runTripAnalysis(driveId),
  ]);
  const congestion = drive.recordingMode === 'TRAFFIC' &&
    (tripAnalysis.status === 'COMPLETED' || tripAnalysis.status === 'PARTIAL')
    ? await runCongestionAnalysis(driveId)
    : null;
  return { tripAnalysis, congestion };
}
