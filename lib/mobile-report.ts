export const MOBILE_REPORT_SCHEMA_VERSION = '2';
export const SUPPORTED_MOBILE_REPORT_SCHEMA_VERSIONS = new Set(['1', '2']);
export const MAX_LOCATION_SAMPLES = 12_000;
export const MAX_MOTION_SAMPLES = 72_000;

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
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

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
  return { valid: true, value: report as MobileReportRequest };
}
