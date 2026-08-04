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
import { detectCongestion, CongestionEvent as DetectedEvent } from './congestion-detection';
import { CongestionSeverity } from '@prisma/client';

export interface CongestionAnalysisResult {
  matchCount: number;      // Number of GPS-segment matches created
  eventCount: number;      // Number of congestion events detected
  totalDuration: number;   // Total congestion time in milliseconds
}

/**
 * Get start of week for a date (Monday 00:00:00 UTC)
 * Used for weekly trend aggregation
 *
 * Deliberately UTC. This value is a bucket key, so it has to be identical no
 * matter where the code runs. The deployment runs in UTC, so every weekStart
 * already stored is UTC midnight; computing it with local-time methods on a
 * developer machine would silently produce a second, offset set of weekly rows
 * for the same weeks.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Minimal shape needed to aggregate a congestion event into segment statistics.
 * Satisfied by both freshly detected events and stored CongestionEvent rows.
 */
export interface SegmentStatsEvent {
  segmentId: string;
  dayOfWeek: number;
  hourOfDay: number;
  startTime: Date;
  duration: number;
  avgSpeed: number;
  severity: CongestionSeverity;
}

/**
 * A single computed SegmentStatistics row, keyed by its time window.
 */
export interface SegmentStatsAggregate {
  segmentId: string;
  dayOfWeek: number | null;
  hourOfDay: number | null;
  weekStart: Date | null;
  eventCount: number;
  totalDuration: number;
  avgSpeed: number | null;
  pctFreeFlow: number;
  pctSlow: number;
  pctCongested: number;
  pctHeavy: number;
  pctGridlock: number;
  congestionScore: number;
}

/**
 * Aggregate congestion events into SegmentStatistics rows.
 *
 * Pure: given the same events it always returns the same rows, with no database
 * access and no dependence on what is already stored. Each event fans out into
 * five time windows (all-time, per day-of-week, per hour, per day+hour, per week).
 *
 * Shared by the incremental pipeline and the full rebuild script so the two can
 * never disagree about how a window is keyed or scored.
 */
export function aggregateSegmentStatistics(
  events: SegmentStatsEvent[]
): SegmentStatsAggregate[] {
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

  return Array.from(aggregates.values()).map((agg) => {
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

    return {
      segmentId,
      dayOfWeek,
      hourOfDay,
      weekStart,
      eventCount: stats.eventCount,
      totalDuration: stats.totalDuration,
      avgSpeed,
      pctFreeFlow,
      pctSlow,
      pctCongested,
      pctHeavy,
      pctGridlock,
      congestionScore,
    };
  });
}

/**
 * Update segment statistics with new congestion events
 * Uses upsert to incrementally update aggregates
 */
async function updateSegmentStatistics(events: DetectedEvent[]): Promise<void> {
  for (const agg of aggregateSegmentStatistics(events)) {
    const { segmentId, dayOfWeek, hourOfDay, weekStart } = agg;

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
            increment: agg.eventCount,
          },
          totalDuration: {
            increment: agg.totalDuration,
          },
          avgSpeed: agg.avgSpeed,
          avgCongestionSpeed: agg.avgSpeed,
          pctFreeFlow: agg.pctFreeFlow,
          pctSlow: agg.pctSlow,
          pctCongested: agg.pctCongested,
          pctHeavy: agg.pctHeavy,
          pctGridlock: agg.pctGridlock,
          congestionScore: agg.congestionScore,
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
          eventCount: agg.eventCount,
          totalDuration: agg.totalDuration,
          avgSpeed: agg.avgSpeed,
          avgCongestionSpeed: agg.avgSpeed,
          pctFreeFlow: agg.pctFreeFlow,
          pctSlow: agg.pctSlow,
          pctCongested: agg.pctCongested,
          pctHeavy: agg.pctHeavy,
          pctGridlock: agg.pctGridlock,
          congestionScore: agg.congestionScore,
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
 * GPS-to-segment matches must already have been produced by trip analysis.
 *
 * @param driveId ID of the completed drive
 * @returns Analysis results (match count, event count, total duration)
 */
export async function runCongestionAnalysis(
  driveId: string
): Promise<CongestionAnalysisResult> {
  const existingEvents = await prisma.congestionEvent.findMany({
    where: { driveId },
    select: { duration: true },
  });
  if (existingEvents.length > 0) {
    return {
      matchCount: await prisma.gpsSegmentMatch.count({ where: { gps: { driveId } } }),
      eventCount: existingEvents.length,
      totalDuration: existingEvents.reduce((sum, event) => sum + event.duration, 0),
    };
  }

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
      segmentMatches: {
        take: 1,
        select: { segmentId: true },
      },
    },
  });

  if (gpsSamples.length === 0) {
    return { matchCount: 0, eventCount: 0, totalDuration: 0 };
  }

  const gpsWithSegments = gpsSamples.map(({ segmentMatches, ...gps }) => ({
    ...gps,
    segmentId: segmentMatches[0]?.segmentId,
  }));
  const matchCount = gpsWithSegments.filter((sample) => sample.segmentId).length;

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
    matchCount,
    eventCount: events.length,
    totalDuration: events.reduce((sum, e) => sum + e.duration, 0),
  };
}
