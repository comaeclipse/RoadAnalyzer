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
import { tileEdge, tileKeyAt, type SegmentTile } from '@/lib/segment-identity';
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

/**
 * The RoadSegment rows a set of matched edges maps onto.
 *
 * Named roads resolve through `byTileKey`: identity is the tile, so a sample is
 * filed by looking up the tile its snapped position falls in. Unnamed edges get
 * no tiles -- there is nothing to tell two unnamed stubs in one cell apart --
 * and keep the old per-sourceId row, reached through `bySourceId`.
 */
interface EdgeSegments {
  byTileKey: Map<string, { id: string; geometry: GeoJSON.LineString }>;
  bySourceId: Map<string, string>;
  tilesBySourceId: Map<string, SegmentTile[]>;
}

/**
 * Store each matched edge as RoadSegment rows, reusing the rows for ground
 * already driven.
 *
 * A named edge is cut into tiles and each tile is its own row, so the row for a
 * stretch is the same however far this particular drive travelled along it.
 * Mapbox's sourceId is kept as provenance only; keying on it filed every
 * re-drive as a new road.
 *
 * There is no unique constraint on the key yet, so reuse is a read followed by a
 * write rather than an upsert, and two concurrent analyses of one road can still
 * both insert. The constraint closes that; until then the read-layer dedupe
 * covers it.
 */
async function upsertEdges(edges: MatchedEdge[]): Promise<EdgeSegments> {
  const byTileKey: EdgeSegments['byTileKey'] = new Map();
  const bySourceId = new Map<string, string>();
  const tilesBySourceId = new Map<string, SegmentTile[]>();

  for (const edge of edges) {
    const tiles = tileEdge(edge);
    tilesBySourceId.set(edge.sourceId, tiles);

    if (tiles.length === 0) {
      const bounds = calculateBoundingBox(edge.geometry);
      const data = {
        name: edge.name,
        geometry: edge.geometry as unknown as Prisma.InputJsonValue,
        ...bounds,
        isActive: true,
      };
      // sourceId is provenance now, not identity, so there is no unique index
      // to upsert against. An unnamed edge therefore keeps the old behaviour
      // exactly: one row per OpenLR reference, over-creating rather than
      // merging stubs it cannot tell apart.
      const existing = await prisma.roadSegment.findFirst({
        where: { source: 'MAPBOX', sourceId: edge.sourceId, spatialKey: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const segment = existing
        ? await prisma.roadSegment.update({ where: { id: existing.id }, data, select: { id: true } })
        : await prisma.roadSegment.create({
            data: { ...data, source: 'MAPBOX', sourceId: edge.sourceId },
            select: { id: true },
          });
      bySourceId.set(edge.sourceId, segment.id);
      continue;
    }

    for (const tile of tiles) {
      if (byTileKey.has(tile.key)) continue;
      const bounds = calculateBoundingBox(tile.geometry);
      const existing = await prisma.roadSegment.findFirst({
        where: { source: 'MAPBOX', spatialKey: tile.key },
        // Oldest wins, so an id already referenced by history keeps being the
        // one written to.
        orderBy: { createdAt: 'asc' },
        select: { id: true, geometry: true },
      });

      if (!existing) {
        const created = await prisma.roadSegment.create({
          data: {
            name: edge.name,
            geometry: tile.geometry as unknown as Prisma.InputJsonValue,
            ...bounds,
            source: 'MAPBOX',
            sourceId: edge.sourceId,
            spatialKey: tile.key,
          },
          select: { id: true },
        });
        byTileKey.set(tile.key, { id: created.id, geometry: tile.geometry });
        continue;
      }

      // A tile's stored geometry is the longest description of that stretch
      // seen so far. A drive that clipped the corner of a cell should not
      // shrink the row a fuller pass already established.
      const stored = existing.geometry as unknown as GeoJSON.LineString;
      const better = (stored?.coordinates?.length ?? 0) < tile.geometry.coordinates.length;
      if (better) {
        await prisma.roadSegment.update({
          where: { id: existing.id },
          data: {
            name: edge.name,
            geometry: tile.geometry as unknown as Prisma.InputJsonValue,
            ...bounds,
            isActive: true,
          },
        });
      }
      byTileKey.set(tile.key, { id: existing.id, geometry: better ? tile.geometry : stored });
    }
  }

  return { byTileKey, bySourceId, tilesBySourceId };
}

/**
 * The segment a sample belongs to, and where along it the sample sits.
 *
 * Normally the tile containing the snapped position. A position exactly on a
 * cell boundary, or in a cell the edge only grazed and so has no tile for,
 * falls back to the nearest tile this edge produced rather than losing its
 * match. Unnamed edges have no tiles and resolve to their own row.
 */
function fileOnSegment(
  edge: MatchedEdge,
  snapped: GeoJSON.Position,
  segments: EdgeSegments
): { segmentId: string; position: number } | null {
  const legacyId = segments.bySourceId.get(edge.sourceId);
  if (legacyId) {
    const line = turf.lineString(edge.geometry.coordinates);
    return { segmentId: legacyId, position: positionAlong(line, snapped) };
  }

  const key = tileKeyAt(edge.name, snapped);
  let match = key ? segments.byTileKey.get(key) : undefined;
  if (!match) {
    const tiles = segments.tilesBySourceId.get(edge.sourceId) ?? [];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
      const candidate = segments.byTileKey.get(tile.key);
      if (!candidate) continue;
      const distance = Number(turf.nearestPointOnLine(
        turf.lineString(tile.geometry.coordinates),
        turf.point(snapped),
        { units: 'meters' }
      ).properties.dist ?? Number.POSITIVE_INFINITY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        match = candidate;
      }
    }
  }
  if (!match) return null;

  return {
    segmentId: match.id,
    position: positionAlong(turf.lineString(match.geometry.coordinates), snapped),
  };
}

/** Where along a line a position sits, as a fraction in [0, 1]. */
function positionAlong(line: GeoJSON.Feature<GeoJSON.LineString>, position: GeoJSON.Position): number {
  const length = turf.length(line, { units: 'kilometers' });
  if (length <= 0) return 0;
  const snapped = turf.nearestPointOnLine(line, turf.point(position), { units: 'meters' });
  return Math.max(0, Math.min(1, Number(snapped.properties.location ?? 0) / length));
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

  const [gpsSamples, pauseRows] = await Promise.all([
    prisma.gpsSample.findMany({
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
    }),
    prisma.pausedInterval.findMany({
      where: { driveId },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true, endedAt: true },
    }),
  ]);
  const pauses = pauseRows.map((pause) => ({
    startedAt: pause.startedAt.getTime(),
    endedAt: pause.endedAt?.getTime() ?? null,
  }));

  try {
    const result = await matchTrace(gpsSamples, { pauses });
    const [edgeSegments, manualSegments] = await Promise.all([
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
      if (nearest && nearest.distance <= 50) {
        const snapped = turf.nearestPointOnLine(
          turf.lineString(nearest.edge.geometry.coordinates),
          turf.point([sample.longitude, sample.latitude]),
          { units: 'meters' }
        );
        // The segment is the tile the snapped position lands in, so a drive is
        // filed against the same stretches as every other drive over the same
        // ground, whatever extent this one happened to match.
        const filed = fileOnSegment(nearest.edge, snapped.geometry.coordinates, edgeSegments);
        if (filed) {
          matches.push({
            gpsId: sample.id,
            segmentId: filed.segmentId,
            distance: nearest.distance,
            position: filed.position,
            snappedLatitude: snapped.geometry.coordinates[1],
            snappedLongitude: snapped.geometry.coordinates[0],
            confidence: pointConfidence.get(sample.id) ?? nearest.edge.confidence,
            source: 'MAPBOX',
          });
          continue;
        }
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
