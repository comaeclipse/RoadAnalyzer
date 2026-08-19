import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  analyzeIntersections,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
} from '@/lib/intersection-stops';
import { associateSignal, kindForHighwayTag, type OsmNode } from '@/lib/osm-signals';

export const dynamic = 'force-dynamic';

/**
 * The approach heading the phone recorded with a tag.
 *
 * TrafficTag has no column for it, so ingest packs it into the free-text note
 * as `approach=<degrees>` alongside the anchor id. Tags predating that, and any
 * placed in the web UI, have none; analyzeIntersections recovers those from the
 * drive's own trace.
 */
function approachHeadingFromNote(note: string | null): number | null {
  const match = /approach=(\d+(?:\.\d+)?)/.exec(note ?? '');
  if (!match) return null;
  const degrees = Number(match[1]);
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : null;
}

// GET /api/intersections - Rank recurring stops by approach direction
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minPassesParam = searchParams.get('minPasses');
    const minPasses = minPassesParam === null ? 1 : Number(minPassesParam);
    if (!Number.isInteger(minPasses) || minPasses < 1) {
      return NextResponse.json({ error: 'Invalid minPasses filter' }, { status: 400 });
    }

    const drives = await prisma.drive.findMany({
      where: { status: 'COMPLETED', recordingMode: 'TRAFFIC' },
      orderBy: { startTime: 'desc' },
      select: {
        id: true,
        name: true,
        startTime: true,
        gpsData: {
          orderBy: { timestamp: 'asc' },
          select: {
            latitude: true,
            longitude: true,
            speed: true,
            timestamp: true,
            segmentMatches: {
              take: 1,
              select: { segment: { select: { name: true } } },
            },
          },
        },
        trafficTags: {
          select: { latitude: true, longitude: true, kind: true, startTime: true, note: true },
        },
      },
    });

    const analysisDrives: AnalysisDrive[] = drives
      .filter((drive) => drive.gpsData.length >= 2)
      .map((drive) => ({
        id: drive.id,
        name: drive.name,
        startTime: drive.startTime.toISOString(),
        points: drive.gpsData.map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
          speed: point.speed,
          timestamp: Number(point.timestamp),
          roadName: point.segmentMatches[0]?.segment.name ?? null,
        })),
        tags: drive.trafficTags.map((tag) => ({
          lat: tag.latitude,
          lng: tag.longitude,
          kind: tag.kind,
          bearing: approachHeadingFromNote(tag.note),
          timestamp: tag.startTime.getTime(),
        })),
      }));

    const measured = analyzeIntersections(analysisDrives).filter(
      (approach) => approach.passes >= minPasses
    );

    // Read from our own cache, never from Overpass: a page that failed because
    // a third-party API was rate limiting would be a bad trade for a label.
    const signalRows = await prisma.osmSignal.findMany({
      select: {
        osmNodeId: true, latitude: true, longitude: true,
        highway: true, direction: true, tags: true, onDrivenRoad: true,
      },
    });
    const signals: OsmNode[] = signalRows.map((row) => ({
      osmNodeId: Number(row.osmNodeId),
      latitude: row.latitude,
      longitude: row.longitude,
      highway: row.highway,
      direction: row.direction,
      tags: row.tags as Record<string, string>,
    }));

    // Purely additive. The OSM control is reported alongside the driver's own
    // label rather than folded into it: a driver confirming "that was a red
    // light" as it happened is stronger evidence than a map, and blurring the
    // two would cost us the more valuable of them. No probability or delay
    // figure is touched here.
    const associated = new Set<number>();
    const approaches = measured.map((approach) => {
      const found = associateSignal(approach, signals);
      if (found) associated.add(found.signal.osmNodeId);
      return {
        ...approach,
        osm: found ? {
          nodeId: found.signal.osmNodeId,
          kind: kindForHighwayTag(found.signal.highway),
          distance: found.distance,
        } : null,
      };
    });

    const onDrivenRoad = signalRows.filter((row) => row.onDrivenRoad);

    return NextResponse.json({
      approaches,
      summary: {
        driveCount: analysisDrives.length,
        approachCount: approaches.length,
        stopCount: approaches.reduce((total, a) => total + a.stopCount, 0),
        totalDelay: approaches.reduce((total, a) => total + a.totalDelay, 0),
        // Approaches whose denominator had to be raised to meet the stop count.
        // Should be 0; a non-zero value means those rates are floors, not
        // measurements, and is worth investigating rather than rendering plain.
        clampedCount: approaches.filter((a) => a.passesClamped).length,
        // Controls we drive past. The ones with no approach are the junctions
        // we never stop at -- invisible to clustering seeded by stop events,
        // which is the whole reason for importing them.
        osmControls: {
          onDrivenRoad: onDrivenRoad.length,
          associated: associated.size,
          neverStopped: onDrivenRoad.filter((row) => !associated.has(Number(row.osmNodeId))).length,
          lastFetchedAt: signalRows.length
            ? (await prisma.osmSignal.aggregate({ _max: { fetchedAt: true } }))._max.fetchedAt
            : null,
        },
        // Surfaced so the page can explain what "stopped" means here rather
        // than leaving the thresholds implicit.
        thresholds: {
          stoppedSpeedMph: DEFAULT_OPTIONS.stoppedSpeed * 2.23694,
          minStopSeconds: DEFAULT_OPTIONS.minStopDuration / 1000,
          clusterRadiusMeters: DEFAULT_OPTIONS.clusterRadius,
          bearingToleranceDegrees: DEFAULT_OPTIONS.bearingTolerance,
        },
      },
    });
  } catch (error) {
    console.error('Failed to analyze intersections:', error);
    return NextResponse.json({ error: 'Failed to analyze intersections' }, { status: 500 });
  }
}
