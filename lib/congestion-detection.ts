/**
 * Congestion Detection
 *
 * Analyzes GPS speed and motion data to detect traffic congestion events.
 * Uses speed + duration thresholds to distinguish between free-flow, slow traffic,
 * congestion, and gridlock.
 */

import { CongestionSeverity } from '@prisma/client';

export interface GpsSampleWithSegment {
  id: string;
  driveId: string;
  timestamp: bigint;
  speed: number | null;
  distanceFromPrev: number | null;
  segmentId?: string;  // Added by segment matching
}

export interface CongestionEvent {
  driveId: string;
  segmentId: string;
  startTime: Date;
  endTime: Date;
  duration: number;          // milliseconds
  dayOfWeek: number;         // 0-6 (Sunday-Saturday)
  hourOfDay: number;         // 0-23
  weekOfYear: number;        // ISO week number
  severity: CongestionSeverity;
  avgSpeed: number;          // m/s
  minSpeed: number;          // m/s
  maxSpeed: number;          // m/s
  distance: number;          // meters
  startGpsId: string;
  endGpsId: string;
}

export interface CongestionThresholds {
  freeFlowSpeed: number;    // m/s (default: 15 = 33 mph)
  slowSpeed: number;        // m/s (default: 8 = 18 mph)
  congestedSpeed: number;   // m/s (default: 5 = 11 mph)
  heavySpeed: number;       // m/s (default: 2.78 = 6 mph)
  gridlockSpeed: number;    // m/s (default: 1 = 2 mph)
  minDuration: number;      // milliseconds (default: 30000 = 30 seconds)
}

// Default thresholds based on user requirements
export const DEFAULT_THRESHOLDS: CongestionThresholds = {
  freeFlowSpeed: 15,      // 33 mph
  slowSpeed: 8,           // 18 mph
  congestedSpeed: 5,      // 11 mph
  heavySpeed: 2.78,       // 6 mph
  gridlockSpeed: 1,       // 2 mph
  minDuration: 30000,     // 30 seconds
};

/**
 * Classify congestion severity based on average speed
 */
function classifySeverity(
  avgSpeed: number,
  thresholds: CongestionThresholds
): CongestionSeverity {
  if (avgSpeed >= thresholds.freeFlowSpeed) return CongestionSeverity.FREE_FLOW;
  if (avgSpeed >= thresholds.slowSpeed) return CongestionSeverity.SLOW;
  if (avgSpeed >= thresholds.congestedSpeed) return CongestionSeverity.CONGESTED;
  if (avgSpeed >= thresholds.heavySpeed) return CongestionSeverity.HEAVY;
  return CongestionSeverity.GRIDLOCK;
}

/**
 * Get ISO week number for a date
 * Used for weekly trend analysis
 */
function getISOWeek(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/**
 * Finalize a congestion event from collected samples
 * Filters out brief stops (< minDuration) and calculates metrics
 */
function finalizeEvent(
  segmentId: string,
  startSample: GpsSampleWithSegment,
  samples: GpsSampleWithSegment[],
  thresholds: CongestionThresholds
): CongestionEvent | null {
  const endSample = samples[samples.length - 1];
  const duration = Number(endSample.timestamp - startSample.timestamp);

  // Filter out brief stops (red lights, etc.)
  if (duration < thresholds.minDuration) {
    return null;
  }

  // Calculate metrics
  const speeds = samples
    .map(s => s.speed)
    .filter((s): s is number => s !== null && s !== undefined);

  if (speeds.length === 0) {
    return null;
  }

  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  const distance = samples.reduce(
    (sum, s) => sum + (s.distanceFromPrev ?? 0),
    0
  );

  // Classify severity
  const severity = classifySeverity(avgSpeed, thresholds);

  const startTime = new Date(Number(startSample.timestamp));
  const endTime = new Date(Number(endSample.timestamp));

  return {
    driveId: startSample.driveId,
    segmentId,
    startTime,
    endTime,
    duration,
    dayOfWeek: startTime.getDay(),
    hourOfDay: startTime.getHours(),
    weekOfYear: getISOWeek(startTime),
    severity,
    avgSpeed,
    minSpeed,
    maxSpeed,
    distance,
    startGpsId: startSample.id,
    endGpsId: endSample.id,
  };
}

/**
 * Detect congestion events from GPS samples
 *
 * Algorithm:
 * 1. Group GPS samples by segment
 * 2. Sort by timestamp
 * 3. Scan for speed drops below free-flow threshold
 * 4. Identify contiguous low-speed periods
 * 5. Filter out brief stops (< minDuration)
 * 6. Classify severity based on average speed
 * 7. Extract temporal fields (dayOfWeek, hourOfDay, weekOfYear)
 *
 * @param gpsSamples GPS samples with segment matches
 * @param thresholds Optional custom thresholds (uses defaults if not provided)
 * @returns Array of detected congestion events
 */
export function detectCongestion(
  gpsSamples: GpsSampleWithSegment[],
  thresholds: CongestionThresholds = DEFAULT_THRESHOLDS
): CongestionEvent[] {
  const events: CongestionEvent[] = [];

  // Group samples by segment
  const bySegment = new Map<string, GpsSampleWithSegment[]>();
  for (const sample of gpsSamples) {
    if (!sample.segmentId) continue;

    if (!bySegment.has(sample.segmentId)) {
      bySegment.set(sample.segmentId, []);
    }
    bySegment.get(sample.segmentId)!.push(sample);
  }

  // Process each segment
  for (const [segmentId, samples] of Array.from(bySegment.entries())) {
    // Sort by timestamp
    const sorted = samples.sort((a, b) => {
      const aTime = Number(a.timestamp);
      const bTime = Number(b.timestamp);
      return aTime - bTime;
    });

    let eventStart: GpsSampleWithSegment | null = null;
    let eventSamples: GpsSampleWithSegment[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const sample = sorted[i];
      const speed = sample.speed ?? 0;

      if (speed < thresholds.freeFlowSpeed) {
        // Potential congestion
        if (!eventStart) {
          eventStart = sample;
        }
        eventSamples.push(sample);
      } else {
        // Free-flowing again
        if (eventStart && eventSamples.length > 0) {
          const event = finalizeEvent(
            segmentId,
            eventStart,
            eventSamples,
            thresholds
          );
          if (event) {
            events.push(event);
          }
        }
        eventStart = null;
        eventSamples = [];
      }
    }

    // Handle final event if still ongoing at end of drive
    if (eventStart && eventSamples.length > 0) {
      const event = finalizeEvent(
        segmentId,
        eventStart,
        eventSamples,
        thresholds
      );
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

/**
 * Get a human-readable label for a congestion severity level
 */
export function getSeverityLabel(severity: CongestionSeverity): string {
  const labels: Record<CongestionSeverity, string> = {
    [CongestionSeverity.FREE_FLOW]: 'Free Flow',
    [CongestionSeverity.SLOW]: 'Slow',
    [CongestionSeverity.CONGESTED]: 'Congested',
    [CongestionSeverity.HEAVY]: 'Heavy Traffic',
    [CongestionSeverity.GRIDLOCK]: 'Gridlock',
  };
  return labels[severity];
}

/**
 * Get color for congestion severity (for UI display)
 */
export function getSeverityColor(severity: CongestionSeverity): string {
  const colors: Record<CongestionSeverity, string> = {
    [CongestionSeverity.FREE_FLOW]: '#22c55e',  // green
    [CongestionSeverity.SLOW]: '#84cc16',       // lime
    [CongestionSeverity.CONGESTED]: '#eab308',  // yellow
    [CongestionSeverity.HEAVY]: '#f97316',      // orange
    [CongestionSeverity.GRIDLOCK]: '#ef4444',   // red
  };
  return colors[severity];
}
