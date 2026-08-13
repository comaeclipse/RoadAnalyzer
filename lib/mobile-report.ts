export const MOBILE_REPORT_SCHEMA_VERSION = '3';
export const SUPPORTED_MOBILE_REPORT_SCHEMA_VERSIONS = new Set(['1', '2', '3']);
export const MAX_LOCATION_SAMPLES = 12_000;
export const MAX_MOTION_SAMPLES = 72_000;
export const MAX_TRAFFIC_TAGS = 500;
export const MAX_PAUSED_INTERVALS = 100;

/// Timestamps outside the report window by more than this are clock skew, not
/// data. Without the guard a device with a bad clock writes 1970 rows that no
/// query can filter out sensibly.
const TIMESTAMP_SLACK_MS = 60_000;

export type MobileSeverity = 'FREE_FLOW' | 'SLOW' | 'CONGESTED' | 'HEAVY' | 'GRIDLOCK';

export interface MobileLocationSample {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  accuracy: number;
  speedAccuracy?: number | null;
  courseAccuracy?: number | null;
}

export interface MobileMotionSample {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

/// The subset of TrafficTagKind a driver can pick from the phone. The wider
/// enum (INTERSECTION, PARKING, OTHER) stays available to the web tagging UI;
/// offering six choices at a red light would not be usable.
export type MobileTrafficTagKind = 'SLOWDOWN' | 'STOP_SIGN' | 'RED_LIGHT';

/// "Slowdown" has no TrafficTagKind of its own -- it is the driver saying the
/// vehicle crawled rather than stopped at a control, which is what TRAFFIC
/// already means.
export const MOBILE_TRAFFIC_TAG_KINDS: Record<MobileTrafficTagKind, 'TRAFFIC' | 'STOP_SIGN' | 'RED_LIGHT'> = {
  SLOWDOWN: 'TRAFFIC',
  STOP_SIGN: 'STOP_SIGN',
  RED_LIGHT: 'RED_LIGHT',
};

/// Marks a tag as phone-originated in TrafficTag.featureType, so it is
/// distinguishable from one placed against a map feature in the web UI.
export const MOBILE_TRAFFIC_TAG_FEATURE_TYPE = 'ios-stop';

const MOBILE_TAG_SOURCES = new Set<string>(['LIVE', 'REVIEW']);
const MOBILE_PAUSE_END_REASONS = new Set<string>(['USER', 'STOP', 'RECOVERED']);

/// A stop the driver labelled on the phone. Becomes one TrafficTag row, which
/// lib/intersection-stops.ts then picks up by proximity when it classifies the
/// stop clusters it detects from the GPS trace.
export interface MobileTrafficTag {
  /// Device-side stop id. Used verbatim as TrafficTag.featureKey, whose
  /// [driveId, featureKey] unique index makes re-ingest idempotent.
  id: string;
  startedAt: number;
  /// Required: TrafficTag.endTime and duration are non-null, so an unfinished
  /// stop is not uploadable.
  endedAt: number;
  latitude: number;
  longitude: number;
  kind: MobileTrafficTagKind;
  accuracy?: number | null;
  heading?: number | null;
  /// Device-local cluster id for this approach, carried through into the note
  /// so repeat visits remain linkable before server-side clustering runs.
  anchorId?: string | null;
  taggedDuring?: 'LIVE' | 'REVIEW' | null;
}

export interface MobilePausedInterval {
  id: string;
  startedAt: number;
  endedAt?: number | null;
  endedBy?: string | null;
}

export interface MobileReportRequest {
  schemaVersion: string;
  idempotencyKey: string;
  startedAt: number;
  endedAt: number;
  name?: string;
  locations: MobileLocationSample[];
  motionSamples?: MobileMotionSample[];
  device?: { model?: string; osVersion?: string };
  diagnostics?: { batteryLevel?: number | null; networkType?: string; locationAuthorization?: string };
  trafficAnalysisVersion?: string;
  // Both arrays stay optional for every schema version: a v3 client that saw no
  // stops and never paused is the ordinary case, not a malformed report.
  trafficTags?: MobileTrafficTag[];
  pausedIntervals?: MobilePausedInterval[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// The iOS encoder omits nil keys rather than writing null, so every optional
// check has to accept both absent and null -- the `!= null` idiom below.
const isIdString = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 8 && value.length <= 64;

export function validateMobileReport(body: unknown):
  | { valid: true; value: MobileReportRequest }
  | { valid: false; error: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'JSON object required' };
  const report = body as Partial<MobileReportRequest>;
  if (!report.schemaVersion || !SUPPORTED_MOBILE_REPORT_SCHEMA_VERSIONS.has(report.schemaVersion)) {
    return { valid: false, error: 'Unsupported schemaVersion' };
  }
  if (typeof report.idempotencyKey !== 'string' || report.idempotencyKey.length < 16 || report.idempotencyKey.length > 128) {
    return { valid: false, error: 'idempotencyKey must be 16-128 characters' };
  }
  if (!isFiniteNumber(report.startedAt) || !isFiniteNumber(report.endedAt) || report.endedAt < report.startedAt) {
    return { valid: false, error: 'Invalid recording timestamps' };
  }
  if (!Array.isArray(report.locations) || report.locations.length < 2 || report.locations.length > MAX_LOCATION_SAMPLES) {
    return { valid: false, error: `locations must contain 2-${MAX_LOCATION_SAMPLES} samples` };
  }
  if (report.motionSamples !== undefined && (!Array.isArray(report.motionSamples) || report.motionSamples.length > MAX_MOTION_SAMPLES)) {
    return { valid: false, error: `motionSamples may contain at most ${MAX_MOTION_SAMPLES} samples` };
  }
  for (const point of report.locations) {
    if (!point || !isFiniteNumber(point.timestamp) || !isFiniteNumber(point.latitude) || !isFiniteNumber(point.longitude) || !isFiniteNumber(point.accuracy) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180 || point.accuracy < 0 ||
      (point.speed != null && (!isFiniteNumber(point.speed) || point.speed < 0 || point.speed > 150)) ||
      (point.heading != null && (!isFiniteNumber(point.heading) || point.heading < 0 || point.heading > 360)) ||
      (point.speedAccuracy != null && (!isFiniteNumber(point.speedAccuracy) || point.speedAccuracy < 0)) ||
      (point.courseAccuracy != null && (!isFiniteNumber(point.courseAccuracy) || point.courseAccuracy < 0))) {
      return { valid: false, error: 'Invalid location sample' };
    }
  }
  for (const sample of report.motionSamples ?? []) {
    if (!sample || !isFiniteNumber(sample.timestamp) || !isFiniteNumber(sample.x) || !isFiniteNumber(sample.y) || !isFiniteNumber(sample.z)) {
      return { valid: false, error: 'Invalid motion sample' };
    }
  }

  const windowStart = report.startedAt - TIMESTAMP_SLACK_MS;
  const windowEnd = report.endedAt + TIMESTAMP_SLACK_MS;
  const inWindow = (value: number) => value >= windowStart && value <= windowEnd;

  if (report.trafficTags !== undefined) {
    if (!Array.isArray(report.trafficTags) || report.trafficTags.length > MAX_TRAFFIC_TAGS) {
      return { valid: false, error: `trafficTags may contain at most ${MAX_TRAFFIC_TAGS} entries` };
    }
    const seenKeys = new Set<string>();
    for (const tag of report.trafficTags) {
      if (!tag || !isIdString(tag.id) ||
        !isFiniteNumber(tag.startedAt) || !inWindow(tag.startedAt) ||
        !isFiniteNumber(tag.endedAt) || !inWindow(tag.endedAt) || tag.endedAt < tag.startedAt ||
        !isFiniteNumber(tag.latitude) || !isFiniteNumber(tag.longitude) ||
        tag.latitude < -90 || tag.latitude > 90 || tag.longitude < -180 || tag.longitude > 180 ||
        typeof tag.kind !== 'string' || !(tag.kind in MOBILE_TRAFFIC_TAG_KINDS) ||
        (tag.accuracy != null && (!isFiniteNumber(tag.accuracy) || tag.accuracy < 0)) ||
        (tag.heading != null && (!isFiniteNumber(tag.heading) || tag.heading < 0 || tag.heading > 360)) ||
        (tag.anchorId != null && !isIdString(tag.anchorId)) ||
        (tag.taggedDuring != null && !MOBILE_TAG_SOURCES.has(tag.taggedDuring))) {
        return { valid: false, error: 'Invalid traffic tag' };
      }
      // featureKey is unique per drive, so a duplicate id would make the ingest
      // silently drop a tag. Reject it here rather than losing a label quietly.
      if (seenKeys.has(tag.id)) {
        return { valid: false, error: 'trafficTags contains duplicate ids' };
      }
      seenKeys.add(tag.id);
    }
  }

  if (report.pausedIntervals !== undefined) {
    if (!Array.isArray(report.pausedIntervals) || report.pausedIntervals.length > MAX_PAUSED_INTERVALS) {
      return { valid: false, error: `pausedIntervals may contain at most ${MAX_PAUSED_INTERVALS} entries` };
    }
    // Overlapping pauses would double-count when the ingest route subtracts
    // paused time from the drive duration, so reject them rather than
    // defensively merging on every read.
    let previousEnd = -Infinity;
    for (const pause of report.pausedIntervals) {
      if (!pause || !isIdString(pause.id) ||
        !isFiniteNumber(pause.startedAt) || !inWindow(pause.startedAt) ||
        (pause.endedAt != null && (!isFiniteNumber(pause.endedAt) || pause.endedAt < pause.startedAt || !inWindow(pause.endedAt))) ||
        (pause.endedBy != null && !MOBILE_PAUSE_END_REASONS.has(pause.endedBy))) {
        return { valid: false, error: 'Invalid paused interval' };
      }
      if (pause.startedAt < previousEnd) {
        return { valid: false, error: 'pausedIntervals must be sorted and non-overlapping' };
      }
      previousEnd = pause.endedAt ?? Infinity;
    }
  }

  return { valid: true, value: report as MobileReportRequest };
}

/// Milliseconds of a report that the driver deliberately excluded. Open-ended
/// intervals are clamped to `endedAt` -- a session killed mid-pause leaves one
/// behind, and treating it as infinite would zero out the whole drive.
export function totalPausedDuration(
  intervals: MobilePausedInterval[] | undefined,
  endedAt: number
): number {
  return (intervals ?? []).reduce(
    (total, pause) => total + Math.max(0, Math.min(pause.endedAt ?? endedAt, endedAt) - pause.startedAt),
    0
  );
}

/// True when `timestamp` falls inside any paused interval. Used to keep paused
/// spans out of both the distance accumulator and the duration.
export function isWithinPause(
  intervals: MobilePausedInterval[] | undefined,
  timestamp: number,
  endedAt: number
): boolean {
  return (intervals ?? []).some(
    (pause) => timestamp >= pause.startedAt && timestamp <= Math.min(pause.endedAt ?? endedAt, endedAt)
  );
}
