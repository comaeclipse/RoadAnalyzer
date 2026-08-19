import * as turf from '@turf/turf';
import { PauseSpan, splitAtPauses } from './pauses';

export const MAPBOX_MATCHING_VERSION = 'v5';
export const MAPBOX_MAX_COORDINATES = 100;
export const MAPBOX_CHUNK_OVERLAP = 5;
export const TARGET_SAMPLE_INTERVAL_MS = 5_000;

export interface MatchInputPoint {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: bigint | number;
  accuracy: number;
  heading: number | null;
}

export interface PreparedMatchPoint extends Omit<MatchInputPoint, 'timestamp'> {
  timestamp: number;
}

export interface MatchedEdge {
  sourceId: string;
  name: string;
  geometry: GeoJSON.LineString;
  confidence: number;
}

export interface MatchedPoint {
  gpsId: string;
  latitude: number;
  longitude: number;
  confidence: number;
  edgeSourceId: string | null;
  edgePosition: number;
}

export interface NormalizedManeuver {
  type: string;
  modifier: string | null;
  turnType: string;
  instruction: string;
  fromRoad: string | null;
  toRoad: string | null;
  latitude: number;
  longitude: number;
  bearingBefore: number | null;
  bearingAfter: number | null;
  angleDegrees: number | null;
  confidence: number;
}

export interface MapMatchResult {
  geometry: GeoJSON.LineString;
  distance: number;
  confidence: number;
  coverage: number;
  totalPointCount: number;
  matchedPointCount: number;
  edges: MatchedEdge[];
  points: MatchedPoint[];
  maneuvers: NormalizedManeuver[];
  trafficContext: MapboxTrafficContext;
  partial: boolean;
}

export interface MapboxTrafficContext {
  provider: 'mapbox';
  analyzedAt: string;
  annotatedDistance: number;
  speedLimitAverage: number | null;
  speedLimitCoverage: number;
  congestionScore: number | null;
  congestionLevel: 'LOW' | 'MODERATE' | 'HEAVY' | 'SEVERE' | 'UNKNOWN';
}

interface MapboxTracepoint {
  location: [number, number];
  name?: string;
  matchings_index: number;
  waypoint_index?: number | null;
  alternatives_count?: number;
}

interface MapboxStep {
  name?: string;
  geometry?: GeoJSON.LineString;
  maneuver: {
    type: string;
    modifier?: string;
    instruction?: string;
    location: [number, number];
    bearing_before?: number;
    bearing_after?: number;
  };
}

interface MapboxMatching {
  confidence: number;
  distance: number;
  geometry: GeoJSON.LineString;
  linear_references?: string[];
  legs?: Array<{
    steps?: MapboxStep[];
    annotation?: {
      distance?: number[];
      congestion?: Array<'low' | 'moderate' | 'heavy' | 'severe' | 'unknown'>;
      congestion_numeric?: Array<number | null>;
      maxspeed?: Array<{ speed?: number; unit?: 'mph' | 'km/h'; unknown?: boolean }>;
    };
  }>;
}

interface MapboxResponse {
  code: string;
  message?: string;
  matchings?: MapboxMatching[];
  tracepoints?: Array<MapboxTracepoint | null>;
}

export class MapMatchingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message?: string
  ) {
    super(message || code);
    this.name = 'MapMatchingError';
  }
}

function headingDelta(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

export function prepareTrace(points: MatchInputPoint[]): PreparedMatchPoint[] {
  const valid = points
    .map((point) => ({ ...point, timestamp: Number(point.timestamp) }))
    .filter((point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Number.isFinite(point.timestamp) &&
      Number.isFinite(point.accuracy) &&
      point.latitude >= -90 && point.latitude <= 90 &&
      point.longitude >= -180 && point.longitude <= 180 &&
      point.accuracy >= 0 && point.accuracy <= 50
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((point, index, sorted) => {
      if (index === 0) return true;
      const previous = sorted[index - 1];
      return point.timestamp > previous.timestamp &&
        (point.latitude !== previous.latitude || point.longitude !== previous.longitude);
    });

  if (valid.length <= 2) return valid;

  const prepared: PreparedMatchPoint[] = [valid[0]];
  for (let index = 1; index < valid.length - 1; index++) {
    const point = valid[index];
    const last = prepared[prepared.length - 1];
    const courseChanged = point.heading != null && last.heading != null &&
      headingDelta(last.heading, point.heading) >= 25;
    if (point.timestamp - last.timestamp >= TARGET_SAMPLE_INTERVAL_MS || courseChanged) {
      prepared.push(point);
    }
  }
  const finalPoint = valid[valid.length - 1];
  if (prepared[prepared.length - 1].id !== finalPoint.id) prepared.push(finalPoint);
  return prepared;
}

/**
 * Splits into request-sized chunks, never letting one span a pause. Mapbox
 * matches a chunk as a single continuous drive, so a chunk holding both sides
 * of a pause comes back routed along whatever roads connect them -- a path the
 * driver never took, drawn with the same confidence as the rest of the trace.
 * Matching each side separately leaves an honest gap instead.
 */
export function chunkTrace(
  points: PreparedMatchPoint[],
  pauses?: readonly PauseSpan[]
): PreparedMatchPoint[][] {
  const spans = pauses?.length
    ? splitAtPauses(points, pauses, (point) => point.timestamp, Number.POSITIVE_INFINITY)
    : [points];
  return spans.flatMap(chunkSpan);
}

function chunkSpan(points: PreparedMatchPoint[]): PreparedMatchPoint[][] {
  if (points.length <= MAPBOX_MAX_COORDINATES) return points.length >= 2 ? [points] : [];
  const chunks: PreparedMatchPoint[][] = [];
  const stride = MAPBOX_MAX_COORDINATES - MAPBOX_CHUNK_OVERLAP;
  for (let start = 0; start < points.length - 1; start += stride) {
    const chunk = points.slice(start, start + MAPBOX_MAX_COORDINATES);
    if (chunk.length >= 2) chunks.push(chunk);
    if (start + MAPBOX_MAX_COORDINATES >= points.length) break;
  }
  return chunks;
}

function clampRadius(accuracy: number): number {
  return Math.min(50, Math.max(5, Math.round(accuracy)));
}

async function requestChunk(
  points: PreparedMatchPoint[],
  token: string,
  fetchImpl: typeof fetch,
  includeWaypoints = true
): Promise<MapboxResponse> {
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(';');
  const timestamps = points.map((point) => Math.floor(point.timestamp / 1000)).join(';');
  const radiuses = points.map((point) => clampRadius(point.accuracy)).join(';');
  const body = new URLSearchParams({
    coordinates,
    timestamps,
    radiuses,
    steps: 'true',
    geometries: 'geojson',
    overview: 'full',
    language: 'en',
    linear_references: 'true',
    annotations: 'distance,congestion,congestion_numeric,maxspeed',
  });
  if (includeWaypoints) body.set('waypoints', `0;${points.length - 1}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetchImpl(
      `https://api.mapbox.com/matching/v5/mapbox/driving-traffic?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      }
    );
    const payload = await response.json().catch(() => ({})) as MapboxResponse;
    if (!response.ok) {
      const retryable = [401, 403, 408, 429].includes(response.status) || response.status >= 500;
      throw new MapMatchingError(payload.code || `HTTP_${response.status}`, retryable, payload.message);
    }
    if (payload.code === 'NoMatch' && includeWaypoints) {
      return requestChunk(points, token, fetchImpl, false);
    }
    if (payload.code !== 'Ok') {
      const retryable = !['NoMatch', 'NoSegment', 'InvalidInput'].includes(payload.code);
      throw new MapMatchingError(payload.code, retryable, payload.message);
    }
    return payload;
  } catch (error) {
    if (error instanceof MapMatchingError) throw error;
    const message = error instanceof Error ? error.message : 'Mapbox request failed';
    throw new MapMatchingError('NETWORK_ERROR', true, message);
  } finally {
    clearTimeout(timeout);
  }
}

function splitGeometryByReferences(
  matching: MapboxMatching,
  tracepoints: Array<MapboxTracepoint | null>
): MatchedEdge[] {
  const coordinates = matching.geometry?.coordinates ?? [];
  const references = matching.linear_references ?? [];
  if (coordinates.length < 2 || references.length === 0) return [];

  const groups = new Map<number, [number, number][]>();
  const segmentCount = coordinates.length - 1;
  for (let index = 0; index < segmentCount; index++) {
    const referenceIndex = Math.min(
      references.length - 1,
      Math.floor((index * references.length) / segmentCount)
    );
    const group = groups.get(referenceIndex) ?? [];
    const start = coordinates[index] as [number, number];
    const end = coordinates[index + 1] as [number, number];
    if (group.length === 0) group.push(start);
    group.push(end);
    groups.set(referenceIndex, group);
  }

  return references.flatMap((sourceId, index) => {
    const edgeCoordinates = groups.get(index);
    if (!edgeCoordinates || edgeCoordinates.length < 2) return [];
    const midpoint = edgeCoordinates[Math.floor(edgeCoordinates.length / 2)];
    let closestName = '';
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const tracepoint of tracepoints) {
      if (!tracepoint?.name) continue;
      const distance = turf.distance(turf.point(midpoint), turf.point(tracepoint.location), { units: 'meters' });
      if (distance < closestDistance) {
        closestDistance = distance;
        closestName = tracepoint.name;
      }
    }
    return [{
      sourceId,
      name: closestName || 'Unnamed road',
      geometry: { type: 'LineString', coordinates: edgeCoordinates },
      confidence: matching.confidence,
    }];
  });
}

function normalizeTurnType(type: string, modifier?: string): string {
  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') {
    return 'roundabout';
  }
  if (type === 'on ramp') return modifier?.includes('left') ? 'ramp-left' : 'ramp-right';
  if (type === 'off ramp') return modifier?.includes('left') ? 'exit-left' : 'exit-right';
  if (type === 'fork' || type === 'merge') return `${type}-${modifier?.includes('left') ? 'left' : 'right'}`;
  if (modifier === 'uturn') return 'u-turn';
  if (modifier === 'sharp left') return 'sharp-left';
  if (modifier === 'slight left') return 'slight-left';
  if (modifier === 'left') return 'left';
  if (modifier === 'sharp right') return 'sharp-right';
  if (modifier === 'slight right') return 'slight-right';
  if (modifier === 'right') return 'right';
  return type;
}

function isMeaningfulManeuver(step: MapboxStep): boolean {
  const { type, modifier } = step.maneuver;
  if (type === 'depart' || type === 'arrive') return false;
  if (type === 'continue' || type === 'new name') {
    return Boolean(modifier && !['straight', ''].includes(modifier));
  }
  return ['turn', 'fork', 'merge', 'on ramp', 'off ramp', 'roundabout', 'rotary', 'exit roundabout', 'exit rotary'].includes(type);
}

function normalizeAngle(before?: number, after?: number): number | null {
  if (before == null || after == null) return null;
  return ((after - before + 540) % 360) - 180;
}

function normalizeManeuvers(matching: MapboxMatching): NormalizedManeuver[] {
  const steps = (matching.legs ?? []).flatMap((leg) => leg.steps ?? []);
  const result: NormalizedManeuver[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (!isMeaningfulManeuver(step)) continue;
    const previous = steps[index - 1];
    const [longitude, latitude] = step.maneuver.location;
    result.push({
      type: step.maneuver.type,
      modifier: step.maneuver.modifier ?? null,
      turnType: normalizeTurnType(step.maneuver.type, step.maneuver.modifier),
      instruction: step.maneuver.instruction || `Continue onto ${step.name || 'the next road'}`,
      fromRoad: previous?.name || null,
      toRoad: step.name || null,
      latitude,
      longitude,
      bearingBefore: step.maneuver.bearing_before ?? null,
      bearingAfter: step.maneuver.bearing_after ?? null,
      angleDegrees: normalizeAngle(step.maneuver.bearing_before, step.maneuver.bearing_after),
      confidence: matching.confidence,
    });
  }
  return result;
}

function summarizeTraffic(matchings: MapboxMatching[]): MapboxTrafficContext {
  let annotatedDistance = 0;
  let speedLimitDistance = 0;
  let weightedSpeedLimit = 0;
  let congestionDistance = 0;
  let weightedCongestion = 0;
  const levelWeight: Record<string, number> = { low: 15, moderate: 45, heavy: 70, severe: 90 };

  for (const matching of matchings) {
    for (const leg of matching.legs ?? []) {
      const annotation = leg.annotation;
      if (!annotation?.distance) continue;
      annotation.distance.forEach((distance, index) => {
        if (!Number.isFinite(distance) || distance <= 0) return;
        annotatedDistance += distance;
        const speedLimit = annotation.maxspeed?.[index];
        if (speedLimit?.speed && !speedLimit.unknown) {
          const metersPerSecond = speedLimit.unit === 'mph'
            ? speedLimit.speed * 0.44704
            : speedLimit.speed / 3.6;
          weightedSpeedLimit += metersPerSecond * distance;
          speedLimitDistance += distance;
        }
        const numeric = annotation.congestion_numeric?.[index];
        const level = annotation.congestion?.[index];
        const congestion = numeric ?? (level ? levelWeight[level] : undefined);
        if (congestion != null && Number.isFinite(congestion)) {
          weightedCongestion += congestion * distance;
          congestionDistance += distance;
        }
      });
    }
  }

  const congestionScore = congestionDistance ? weightedCongestion / congestionDistance : null;
  const congestionLevel = congestionScore == null ? 'UNKNOWN'
    : congestionScore >= 80 ? 'SEVERE'
      : congestionScore >= 60 ? 'HEAVY'
        : congestionScore >= 30 ? 'MODERATE'
          : 'LOW';
  return {
    provider: 'mapbox',
    analyzedAt: new Date().toISOString(),
    annotatedDistance,
    speedLimitAverage: speedLimitDistance ? weightedSpeedLimit / speedLimitDistance : null,
    speedLimitCoverage: annotatedDistance ? speedLimitDistance / annotatedDistance : 0,
    congestionScore,
    congestionLevel,
  };
}

export function findNearestMatchedEdge(
  location: [number, number],
  edges: MatchedEdge[]
): { edge: MatchedEdge; position: number; distance: number } | null {
  if (!edges.length) return null;
  const point = turf.point(location);
  let best: { edge: MatchedEdge; distance: number; position: number } | null = null;
  for (const edge of edges) {
    const line = turf.lineString(edge.geometry.coordinates);
    const snapped = turf.nearestPointOnLine(line, point, { units: 'meters' });
    const distance = Number(snapped.properties.dist ?? Number.POSITIVE_INFINITY);
    const length = turf.length(line, { units: 'kilometers' });
    const position = length > 0 ? Number(snapped.properties.location ?? 0) / length : 0;
    if (!best || distance < best.distance) best = { edge, distance, position };
  }
  return best ? {
    edge: best.edge,
    position: Math.max(0, Math.min(1, best.position)),
    distance: best.distance,
  } : null;
}

function appendGeometry(target: [number, number][], source: GeoJSON.Position[]): void {
  let startIndex = 0;
  if (target.length > 0 && source.length > 0) {
    const previous = turf.point(target[target.length - 1]);
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    source.forEach((coordinate, index) => {
      const distance = turf.distance(previous, turf.point(coordinate), { units: 'meters' });
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestDistance <= 100) startIndex = nearestIndex + 1;
  }
  for (const coordinate of source.slice(startIndex)) {
    const next = coordinate as [number, number];
    const previous = target[target.length - 1];
    if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) target.push(next);
  }
}

export async function matchTrace(
  input: MatchInputPoint[],
  options: { token?: string; fetchImpl?: typeof fetch; concurrency?: number; pauses?: readonly PauseSpan[] } = {}
): Promise<MapMatchResult> {
  const token = options.token ?? process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new MapMatchingError('MISSING_TOKEN', true, 'MAPBOX_ACCESS_TOKEN is not configured');
  const prepared = prepareTrace(input);
  if (prepared.length < 2) throw new MapMatchingError('INSUFFICIENT_POINTS', false);
  const chunks = chunkTrace(prepared, options.pauses);
  const fetchImpl = options.fetchImpl ?? fetch;
  const responses: Array<MapboxResponse | MapMatchingError> = new Array(chunks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(options.concurrency ?? 3, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const index = cursor++;
      try {
        responses[index] = await requestChunk(chunks[index], token, fetchImpl);
      } catch (error) {
        responses[index] = error instanceof MapMatchingError
          ? error
          : new MapMatchingError('UNKNOWN_ERROR', true);
      }
    }
  });
  await Promise.all(workers);

  const retryableError = responses.find(
    (response): response is MapMatchingError => response instanceof MapMatchingError && response.retryable
  );
  if (retryableError) throw retryableError;

  const geometryCoordinates: [number, number][] = [];
  const edgeMap = new Map<string, MatchedEdge>();
  const pointMap = new Map<string, MatchedPoint>();
  const maneuverMap = new Map<string, NormalizedManeuver>();
  const trafficMatchings: MapboxMatching[] = [];
  let weightedConfidence = 0;
  let matchedDistance = 0;
  let successfulChunks = 0;

  responses.forEach((response, chunkIndex) => {
    if (response instanceof MapMatchingError) return;
    successfulChunks++;
    const chunk = chunks[chunkIndex];
    const matchings = response.matchings ?? [];
    trafficMatchings.push(...matchings);
    const tracepoints = response.tracepoints ?? [];
    const chunkEdges: MatchedEdge[] = [];
    for (let matchingIndex = 0; matchingIndex < matchings.length; matchingIndex++) {
      const matching = matchings[matchingIndex];
      appendGeometry(geometryCoordinates, matching.geometry.coordinates);
      matchedDistance += matching.distance;
      weightedConfidence += matching.confidence * Math.max(1, matching.distance);
      const matchingTracepoints = tracepoints.filter((tracepoint) => tracepoint?.matchings_index === matchingIndex);
      const edges = splitGeometryByReferences(matching, matchingTracepoints);
      for (const edge of edges) {
        chunkEdges.push(edge);
        if (!edgeMap.has(edge.sourceId)) edgeMap.set(edge.sourceId, edge);
      }
      for (const maneuver of normalizeManeuvers(matching)) {
        const key = `${maneuver.type}:${maneuver.longitude.toFixed(5)}:${maneuver.latitude.toFixed(5)}`;
        if (!maneuverMap.has(key)) maneuverMap.set(key, maneuver);
      }
    }

    tracepoints.forEach((tracepoint, pointIndex) => {
      const inputPoint = chunk[pointIndex];
      if (!tracepoint || !inputPoint || pointMap.has(inputPoint.id)) return;
      const matching = matchings[tracepoint.matchings_index];
      const nearest = findNearestMatchedEdge(tracepoint.location, chunkEdges);
      pointMap.set(inputPoint.id, {
        gpsId: inputPoint.id,
        longitude: tracepoint.location[0],
        latitude: tracepoint.location[1],
        confidence: matching?.confidence ?? 0,
        edgeSourceId: nearest?.edge.sourceId ?? null,
        edgePosition: nearest?.position ?? 0,
      });
    });
  });

  if (successfulChunks === 0 || geometryCoordinates.length < 2) {
    throw new MapMatchingError('NO_MATCH', false);
  }

  const uniqueDistance = turf.length(turf.lineString(geometryCoordinates), { units: 'meters' });
  const matchedPointCount = pointMap.size;
  const coverage = prepared.length ? matchedPointCount / prepared.length : 0;
  return {
    geometry: { type: 'LineString', coordinates: geometryCoordinates },
    distance: Number.isFinite(uniqueDistance) ? uniqueDistance : matchedDistance,
    confidence: weightedConfidence / Math.max(1, matchedDistance),
    coverage,
    totalPointCount: prepared.length,
    matchedPointCount,
    edges: Array.from(edgeMap.values()),
    points: Array.from(pointMap.values()),
    maneuvers: Array.from(maneuverMap.values()),
    trafficContext: summarizeTraffic(trafficMatchings),
    partial: successfulChunks < chunks.length || coverage < 0.9,
  };
}
