/**
 * Post-Processing Pipeline
 *
 * Main analysis pipeline for congestion detection.
 * Runs after a recording stops to:
 * 1. Match GPS samples to road segments
 * 2. Detect congestion events
 * 3. Insert events into database
 * 4. Update segment statistics
 */

import { prisma } from '@/lib/prisma';
import { matchGpsToSegments, RoadSegmentForMatching } from './segment-matching';
import { detectCongestion, CongestionEvent as DetectedEvent } from './congestion-detection';
import { CongestionSeverity } from '@prisma/client';

export interface CongestionAnalysisResult {
  matchCount: number;      // Number of GPS-segment matches created
  eventCount: number;      // Number of congestion events detected
  totalDuration: number;   // Total congestion time in milliseconds
}

/**
 * Get start of week for a date (Monday 00:00:00)
 * Used for weekly trend aggregation
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Update segment statistics with new congestion events
 * Uses upsert to incrementally update aggregates
 */
async function updateSegmentStatistics(events: DetectedEvent[]): Promise<void> {
  // Group events by aggregation keys
  const aggregates = new Map<string, {
    segmentId: string;
    dayOfWeek: number | null;
    hourOfDay: number | null;
    weekStart: Date | null;
    stats: {
      eventCount: number;
      totalDuration: number;
      speeds: number[];
      severityCounts: Record<CongestionSeverity, number>;
    };
  }>();

  for (const event of events) {
    // Create aggregation keys for different time windows
    const keys = [
      // All-time aggregate
      { key: `${event.segmentId}:all:all:all`, segmentId: event.segmentId, dayOfWeek: null, hourOfDay: null, weekStart: null },
      // Per day of week
      { key: `${event.segmentId}:${event.dayOfWeek}:all:all`, segmentId: event.segmentId, dayOfWeek: event.dayOfWeek, hourOfDay: null, weekStart: null },
      // Per hour
      { key: `${event.segmentId}:all:${event.hourOfDay}:all`, segmentId: event.segmentId, dayOfWeek: null, hourOfDay: event.hourOfDay, weekStart: null },
      // Per day + hour
      { key: `${event.segmentId}:${event.dayOfWeek}:${event.hourOfDay}:all`, segmentId: event.segmentId, dayOfWeek: event.dayOfWeek, hourOfDay: event.hourOfDay, weekStart: null },
      // Weekly trends
      { key: `${event.segmentId}:all:all:${getWeekStart(event.startTime).toISOString()}`, segmentId: event.segmentId, dayOfWeek: null, hourOfDay: null, weekStart: getWeekStart(event.startTime) },
    ];

    for (const { key, segmentId, dayOfWeek, hourOfDay, weekStart } of keys) {
      if (!aggregates.has(key)) {
        aggregates.set(key, {
          segmentId,
          dayOfWeek,
          hourOfDay,
          weekStart,
          stats: {
            eventCount: 0,
            totalDuration: 0,
            speeds: [],
            severityCounts: {
              [CongestionSeverity.FREE_FLOW]: 0,
              [CongestionSeverity.SLOW]: 0,
              [CongestionSeverity.CONGESTED]: 0,
              [CongestionSeverity.HEAVY]: 0,
              [CongestionSeverity.GRIDLOCK]: 0,
            },
          },
        });
      }

      const agg = aggregates.get(key)!;
      agg.stats.eventCount++;
      agg.stats.totalDuration += event.duration;
      agg.stats.speeds.push(event.avgSpeed);
      agg.stats.severityCounts[event.severity]++;
    }
  }

  // Upsert statistics
  for (const agg of Array.from(aggregates.values())) {
    const { segmentId, dayOfWeek, hourOfDay, weekStart, stats } = agg;

    // Calculate aggregate metrics
    const avgSpeed = stats.speeds.length > 0
      ? stats.speeds.reduce((a, b) => a + b, 0) / stats.speeds.length
      : null;

    // Calculate severity percentages
    const total = Object.values(stats.severityCounts).reduce((a, b) => a + b, 0);
    const pctFreeFlow = total > 0 ? (stats.severityCounts[CongestionSeverity.FREE_FLOW] / total) * 100 : 0;
    const pctSlow = total > 0 ? (stats.severityCounts[CongestionSeverity.SLOW] / total) * 100 : 0;
    const pctCongested = total > 0 ? (stats.severityCounts[CongestionSeverity.CONGESTED] / total) * 100 : 0;
    const pctHeavy = total > 0 ? (stats.severityCounts[CongestionSeverity.HEAVY] / total) * 100 : 0;
    const pctGridlock = total > 0 ? (stats.severityCounts[CongestionSeverity.GRIDLOCK] / total) * 100 : 0;

    // Calculate congestion score (0-100, where 100 = always free-flow)
    const congestionScore = (
      pctFreeFlow * 100 +
      pctSlow * 75 +
      pctCongested * 50 +
      pctHeavy * 25 +
      pctGridlock * 0
    ) / 100;

    // Find existing statistics record
    const existing = await prisma.segmentStatistics.findFirst({
      where: {
        segmentId,
        dayOfWeek,
        hourOfDay,
        weekStart,
      },
    });

    if (existing) {
      // Update existing record
      await prisma.segmentStatistics.update({
        where: { id: existing.id },
        data: {
          eventCount: {
            increment: stats.eventCount,
          },
          totalDuration: {
            increment: stats.totalDuration,
          },
          avgSpeed,
          avgCongestionSpeed: avgSpeed,
          pctFreeFlow,
          pctSlow,
          pctCongested,
          pctHeavy,
          pctGridlock,
          congestionScore,
        },
      });
    } else {
      // Create new record
      await prisma.segmentStatistics.create({
        data: {
          segmentId,
          dayOfWeek,
          hourOfDay,
          weekStart,
          sampleCount: 0,
          eventCount: stats.eventCount,
          totalDuration: stats.totalDuration,
          avgSpeed,
          avgCongestionSpeed: avgSpeed,
          pctFreeFlow,
          pctSlow,
          pctCongested,
          pctHeavy,
          pctGridlock,
          congestionScore,
        },
      });
    }
  }
}

/**
 * Run congestion analysis for a completed drive
 *
 * Steps:
 * 1. Fetch GPS samples for the drive
 * 2. Fetch all road segments
 * 3. Match GPS samples to segments
 * 4. Detect congestion events
 * 5. Insert congestion events into database
 * 6. Update segment statistics
 *
 * @param driveId ID of the completed drive
 * @returns Analysis results (match count, event count, total duration)
 */
export async function runCongestionAnalysis(
  driveId: string
): Promise<CongestionAnalysisResult> {
  // Step 1: Fetch GPS samples with speed data
  const gpsSamples = await prisma.gpsSample.findMany({
    where: { driveId },
    orderBy: { timestamp: 'asc' },
    select: {
      id: true,
      driveId: true,
      latitude: true,
      longitude: true,
      speed: true,
      timestamp: true,
      distanceFromPrev: true,
    },
  });

  // If no GPS samples or no segments exist, return early
  if (gpsSamples.length === 0) {
    return { matchCount: 0, eventCount: 0, totalDuration: 0 };
  }

  // Step 2: Fetch all road segments for spatial matching
  const segments = await prisma.roadSegment.findMany({
    select: {
      id: true,
      geometry: true,
      minLat: true,
      maxLat: true,
      minLon: true,
      maxLon: true,
    },
  });

  // If no segments exist, return early
  if (segments.length === 0) {
    return { matchCount: 0, eventCount: 0, totalDuration: 0 };
  }

  // Step 3: Match GPS samples to segments
  const matches: { gpsId: string; segmentId: string; distance: number; position: number }[] = [];
  const gpsWithSegments: Array<{
    id: string;
    driveId: string;
    timestamp: bigint;
    speed: number | null;
    distanceFromPrev: number | null;
    segmentId?: string;
  }> = [];

  for (const gps of gpsSamples) {
    const segmentMatches = matchGpsToSegments(
      { latitude: gps.latitude, longitude: gps.longitude },
      segments as unknown as RoadSegmentForMatching[]
    );

    // Use the closest match (first in sorted array)
    if (segmentMatches.length > 0) {
      const bestMatch = segmentMatches[0];
      matches.push({
        gpsId: gps.id,
        segmentId: bestMatch.segmentId,
        distance: bestMatch.distance,
        position: bestMatch.position,
      });

      gpsWithSegments.push({
        ...gps,
        segmentId: bestMatch.segmentId,
      });
    } else {
      gpsWithSegments.push({ ...gps });
    }
  }

  // Bulk insert GPS-segment matches
  if (matches.length > 0) {
    await prisma.gpsSegmentMatch.createMany({
      data: matches,
      skipDuplicates: true,
    });
  }

  // Step 4: Detect congestion events
  const events = detectCongestion(gpsWithSegments);

  // Step 5: Insert congestion events
  if (events.length > 0) {
    await prisma.congestionEvent.createMany({
      data: events.map(e => ({
        driveId: e.driveId,
        segmentId: e.segmentId,
        startTime: e.startTime,
        endTime: e.endTime,
        duration: e.duration,
        dayOfWeek: e.dayOfWeek,
        hourOfDay: e.hourOfDay,
        weekOfYear: e.weekOfYear,
        severity: e.severity,
        avgSpeed: e.avgSpeed,
        minSpeed: e.minSpeed,
        maxSpeed: e.maxSpeed,
        distance: e.distance,
        startGpsId: e.startGpsId,
        endGpsId: e.endGpsId,
      })),
    });

    // Step 6: Update segment statistics
    await updateSegmentStatistics(events);
  }

  return {
    matchCount: matches.length,
    eventCount: events.length,
    totalDuration: events.reduce((sum, e) => sum + e.duration, 0),
  };
}
