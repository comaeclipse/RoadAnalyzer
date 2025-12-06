/**
 * Road Segment Matching
 *
 * Matches GPS coordinates to road segments using geospatial algorithms.
 * Uses Turf.js for point-to-line distance calculations and bounding box filtering.
 */

import * as turf from '@turf/turf';

export interface RoadSegmentForMatching {
  id: string;
  geometry: GeoJSON.LineString;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface SegmentMatch {
  segmentId: string;
  distance: number;      // meters from GPS point to segment centerline
  position: number;      // 0.0 to 1.0 along segment
}

export interface GPSPoint {
  latitude: number;
  longitude: number;
}

// Match threshold in meters - GPS points further than this won't match
const MATCH_THRESHOLD = 50; // meters

/**
 * Check if a GPS point is within a segment's bounding box
 * Quick filter before expensive distance calculations
 */
function isInBoundingBox(gps: GPSPoint, segment: RoadSegmentForMatching): boolean {
  return (
    gps.latitude >= segment.minLat &&
    gps.latitude <= segment.maxLat &&
    gps.longitude >= segment.minLon &&
    gps.longitude <= segment.maxLon
  );
}

/**
 * Calculate point-to-line distance and position along line
 * Uses Turf.js for accurate geospatial calculations
 */
function calculatePointToLineDistance(
  point: GPSPoint,
  lineGeometry: GeoJSON.LineString
): { distance: number; position: number } {
  const turfPoint = turf.point([point.longitude, point.latitude]);
  const turfLine = turf.lineString(lineGeometry.coordinates);

  // Find nearest point on line
  const snapped = turf.nearestPointOnLine(turfLine, turfPoint, { units: 'meters' });

  // Distance in meters
  const distance = snapped.properties.dist || 0;

  // Position along line (0.0 to 1.0)
  const lineLength = turf.length(turfLine, { units: 'kilometers' });
  const distanceAlongLine = snapped.properties.location || 0; // km along line
  const position = lineLength > 0 ? distanceAlongLine / lineLength : 0;

  return { distance, position };
}

/**
 * Match a GPS point to road segments
 *
 * Algorithm:
 * 1. Filter segments by bounding box (quick spatial filter)
 * 2. Calculate perpendicular distance to each segment's LineString
 * 3. Only match if distance < MATCH_THRESHOLD (50m by default)
 * 4. Sort matches by distance (closest first)
 *
 * @param gps GPS point to match
 * @param segments Array of road segments to match against
 * @param matchThreshold Optional custom match threshold in meters (default 50)
 * @returns Array of matching segments, sorted by distance (closest first)
 */
export function matchGpsToSegments(
  gps: GPSPoint,
  segments: RoadSegmentForMatching[],
  matchThreshold: number = MATCH_THRESHOLD
): SegmentMatch[] {
  const matches: SegmentMatch[] = [];

  for (const segment of segments) {
    // Quick bounding box filter
    if (!isInBoundingBox(gps, segment)) {
      continue;
    }

    // Calculate point-to-line distance
    const result = calculatePointToLineDistance(gps, segment.geometry);

    // Only match if within threshold
    if (result.distance <= matchThreshold) {
      matches.push({
        segmentId: segment.id,
        distance: result.distance,
        position: result.position,
      });
    }
  }

  // Sort by distance (closest first)
  return matches.sort((a, b) => a.distance - b.distance);
}

/**
 * Calculate bounding box for a GeoJSON LineString
 * Used when creating new segments
 *
 * @param geometry GeoJSON LineString
 * @returns Bounding box { minLat, maxLat, minLon, maxLon }
 */
export function calculateBoundingBox(geometry: GeoJSON.LineString): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  const line = turf.lineString(geometry.coordinates);
  const bbox = turf.bbox(line); // [minLon, minLat, maxLon, maxLat]

  return {
    minLon: bbox[0],
    minLat: bbox[1],
    maxLon: bbox[2],
    maxLat: bbox[3],
  };
}

/**
 * Validate that a geometry is a valid GeoJSON LineString
 *
 * @param geometry Object to validate
 * @returns true if valid LineString
 */
export function isValidLineString(geometry: any): geometry is GeoJSON.LineString {
  if (!geometry || typeof geometry !== 'object') {
    return false;
  }

  if (geometry.type !== 'LineString') {
    return false;
  }

  if (!Array.isArray(geometry.coordinates)) {
    return false;
  }

  // Must have at least 2 points
  if (geometry.coordinates.length < 2) {
    return false;
  }

  // Each coordinate must be [longitude, latitude]
  for (const coord of geometry.coordinates) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return false;
    }
    if (typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
      return false;
    }
    // Validate longitude (-180 to 180) and latitude (-90 to 90)
    if (coord[0] < -180 || coord[0] > 180 || coord[1] < -90 || coord[1] > 90) {
      return false;
    }
  }

  return true;
}
