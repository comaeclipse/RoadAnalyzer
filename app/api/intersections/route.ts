import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  analyzeIntersections,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
  type AnalysisPoint,
} from '@/lib/intersection-stops';
import { associateSignal, kindForHighwayTag, type OsmNode } from '@/lib/osm-signals';

export const dynamic = 'force-dynamic';

/** The drives this page is about: finished, and recorded for traffic. */
const DRIVE_FILTER = { status: 'COMPLETED', recordingMode: 'TRAFFIC' } as const;

/**
 * How long a computed answer is served before it is worked out again.
 *
 * The answer changes only when a drive is uploaded or re-analysed, so almost
 * every request recomputes something that has not moved. A time bound rather
 * than a version key, deliberately: the obvious key -- max(updatedAt) and counts
 * over drives, segments and signals -- measured at 677 ms, which is more than
 * recomputing the whole answer now costs. Latency to the database dominates
 * everything here, so any check that is itself a query defeats the purpose.
 *
 * Sixty seconds is short enough that a drive uploaded from the phone appears
 * while the driver is still looking at the app, and long enough to cover the
 * repeated loads of somebody actually reading the page.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Cached per-process, so on serverless it is per warm instance. That is the
 * right shape for this: instances are cheap to miss and there is nothing to
 * invalidate across them, since a write happens in a different instance
 * entirely and could not be told about anyway.
 *
 * Keyed by the filter, because the page's dropdown offers four of them and a
 * single slot would be thrown away every time the reader changed their mind.
 */
const cache = new Map<number, { expires: number; body: unknown }>();

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

    const hit = cache.get(minPasses);
    if (hit && hit.expires > Date.now()) return NextResponse.json(hit.body);

    // Four flat queries rather than one nested one. The road name used to come
    // from a `segmentMatches: { take: 1 }` sub-select on every GPS row, which
    // Postgres runs as a correlated lateral join 28k times: measured at 2310 ms
    // against 392 ms for the same query without it. Fetching the matches and
    // the segment names separately and joining them here costs one extra round
    // trip and turns the whole load into ~450 ms.
    const [driveRows, gpsRows, matchRows, segmentRows] = await Promise.all([
      prisma.drive.findMany({
        where: DRIVE_FILTER,
        orderBy: { startTime: 'desc' },
        select: {
          id: true,
          name: true,
          startTime: true,
          trafficTags: {
            select: { latitude: true, longitude: true, kind: true, startTime: true, note: true },
          },
        },
      }),
      prisma.gpsSample.findMany({
        where: { drive: DRIVE_FILTER },
        orderBy: [{ driveId: 'asc' }, { timestamp: 'asc' }],
        select: {
          id: true,
          driveId: true,
          latitude: true,
          longitude: true,
          speed: true,
          timestamp: true,
        },
      }),
      prisma.gpsSegmentMatch.findMany({
        where: { gps: { drive: DRIVE_FILTER } },
        select: { gpsId: true, segmentId: true },
      }),
      prisma.roadSegment.findMany({ select: { id: true, name: true } }),
    ]);

    const segmentName = new Map(segmentRows.map((segment) => [segment.id, segment.name]));
    // First match wins, matching the `take: 1` this replaces. A sample has one
    // match in practice; where it has more, which one is arbitrary either way.
    const roadNameByGps = new Map<string, string>();
    for (const match of matchRows) {
      if (roadNameByGps.has(match.gpsId)) continue;
      const name = segmentName.get(match.segmentId);
      if (name != null) roadNameByGps.set(match.gpsId, name);
    }

    const pointsByDrive = new Map<string, AnalysisPoint[]>();
    for (const row of gpsRows) {
      const points = pointsByDrive.get(row.driveId);
      const point: AnalysisPoint = {
        lat: row.latitude,
        lng: row.longitude,
        speed: row.speed,
        timestamp: Number(row.timestamp),
        roadName: roadNameByGps.get(row.id) ?? null,
      };
      if (points) points.push(point);
      else pointsByDrive.set(row.driveId, [point]);
    }

    const analysisDrives: AnalysisDrive[] = driveRows
      .flatMap((drive) => {
        const points = pointsByDrive.get(drive.id) ?? [];
        if (points.length < 2) return [];
        return [{
          id: drive.id,
          name: drive.name,
          startTime: drive.startTime.toISOString(),
          points,
          tags: drive.trafficTags.map((tag) => ({
            lat: tag.latitude,
            lng: tag.longitude,
            kind: tag.kind,
            bearing: approachHeadingFromNote(tag.note),
            timestamp: tag.startTime.getTime(),
          })),
        }];
      });

    const measured = analyzeIntersections(analysisDrives).filter(
      (approach) => approach.passes >= minPasses
    );

    // Read from our own cache, never from Overpass: a page that failed because
    // a third-party API was rate limiting would be a bad trade for a label.
    const signalRows = await prisma.osmSignal.findMany({
      select: {
        osmNodeId: true, latitude: true, longitude: true,
        highway: true, direction: true, tags: true, onDrivenRoad: true, fetchedAt: true,
      },
    });
    const lastSignalFetch = signalRows.reduce<Date | null>(
      (latest, row) => (latest == null || row.fetchedAt > latest ? row.fetchedAt : latest),
      null
    );
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

    const body = {
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
          // Taken from the rows already in hand rather than a second query for
          // an aggregate of the same table.
          lastFetchedAt: lastSignalFetch,
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
    };

    // Bounded by dropping whatever expired first: minPasses comes off a query
    // string, so an unbounded map is something anyone could grow.
    for (const [key, entry] of Array.from(cache.entries())) {
      if (entry.expires <= Date.now()) cache.delete(key);
    }
    if (cache.size >= 16) cache.delete(Array.from(cache.keys())[0]);
    cache.set(minPasses, { expires: Date.now() + CACHE_TTL_MS, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('Failed to analyze intersections:', error);
    return NextResponse.json({ error: 'Failed to analyze intersections' }, { status: 500 });
  }
}
