/**
 * Traffic controls from OpenStreetMap.
 *
 * We only know about intersections we have stopped at: a cluster in
 * lib/intersection-stops.ts is seeded by stop events, so a signal caught one
 * time in ten is thinly represented and one never caught at all does not exist.
 * The signals that cost the least are exactly the ones we can say least about.
 *
 * OSM records vehicle controls as nodes tagged highway=traffic_signals or
 * highway=stop. Importing the ones along roads we have driven gives a
 * denominator that does not depend on having stopped, and a label that does not
 * depend on the driver having tagged it.
 *
 * This infers nothing about signal state or timing. It gives locations. A
 * driver tag remains the stronger evidence wherever one exists -- a human
 * confirming "that was a red light" at the moment it happened beats any
 * inference from a map.
 */

import { bearingDelta, haversineMeters } from './intersection-stops';

/** A rectangle to query, in degrees. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface OsmNode {
  osmNodeId: number;
  latitude: number;
  longitude: number;
  highway: string;
  direction: string | null;
  tags: Record<string, string>;
}

/** The controls worth importing. Both cost the same to query. */
export const IMPORTED_HIGHWAY_TAGS = ['traffic_signals', 'stop'] as const;

/**
 * Degrees of separation at which two driven areas are treated as different
 * places. About 11 km at this latitude: far enough that a single commute stays
 * one box, close enough that a drive in another city gets its own rather than
 * stretching one box across a continent.
 */
const CLUSTER_GAP_DEGREES = 0.1;

/** Padding on each queried box, so a control just off the driven line is caught. */
const BOX_MARGIN_DEGREES = 0.003;

/**
 * Group driven road boxes into the regions actually worth querying.
 *
 * A single box over everything is the wrong query. Three stray drives in
 * Chicago, San Francisco and Portland stretch one bbox to 1685 x 3407 km, which
 * asks Overpass for a third of a continent to find the signals on one commute.
 */
export function drivenBoundingBoxes(
  segments: BoundingBox[],
  margin = BOX_MARGIN_DEGREES
): BoundingBox[] {
  const clusters: BoundingBox[] = [];

  for (const segment of segments) {
    const near = clusters.find((cluster) =>
      segment.minLat <= cluster.maxLat + CLUSTER_GAP_DEGREES &&
      segment.maxLat >= cluster.minLat - CLUSTER_GAP_DEGREES &&
      segment.minLon <= cluster.maxLon + CLUSTER_GAP_DEGREES &&
      segment.maxLon >= cluster.minLon - CLUSTER_GAP_DEGREES);

    if (near) {
      near.minLat = Math.min(near.minLat, segment.minLat);
      near.maxLat = Math.max(near.maxLat, segment.maxLat);
      near.minLon = Math.min(near.minLon, segment.minLon);
      near.maxLon = Math.max(near.maxLon, segment.maxLon);
      continue;
    }
    clusters.push({ ...segment });
  }

  // Merging can bring two clusters within reach of each other, so settle.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        if (a.minLat <= b.maxLat + CLUSTER_GAP_DEGREES && a.maxLat >= b.minLat - CLUSTER_GAP_DEGREES &&
            a.minLon <= b.maxLon + CLUSTER_GAP_DEGREES && a.maxLon >= b.minLon - CLUSTER_GAP_DEGREES) {
          clusters[i] = {
            minLat: Math.min(a.minLat, b.minLat),
            maxLat: Math.max(a.maxLat, b.maxLat),
            minLon: Math.min(a.minLon, b.minLon),
            maxLon: Math.max(a.maxLon, b.maxLon),
          };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return clusters.map((cluster) => ({
    minLat: cluster.minLat - margin,
    maxLat: cluster.maxLat + margin,
    minLon: cluster.minLon - margin,
    maxLon: cluster.maxLon + margin,
  }));
}

/** Overpass QL for the controls inside one box. */
export function overpassQuery(box: BoundingBox, timeoutSeconds = 90): string {
  const bbox = [box.minLat, box.minLon, box.maxLat, box.maxLon]
    .map((value) => value.toFixed(6)).join(',');
  const clauses = IMPORTED_HIGHWAY_TAGS
    .map((tag) => `  node["highway"="${tag}"](${bbox});`).join('\n');
  return `[out:json][timeout:${timeoutSeconds}];\n(\n${clauses}\n);\nout body;`;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/**
 * Read an Overpass response into nodes, discarding anything malformed.
 *
 * Deliberately total rather than throwing: a partial response should cost the
 * elements it mangled, not the whole import.
 */
export function parseOverpassResponse(body: unknown): OsmNode[] {
  const elements = (body as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];

  const nodes: OsmNode[] = [];
  for (const element of elements) {
    if (element?.type !== 'node') continue;
    const { id, lat, lon, tags } = element;
    if (typeof id !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const highway = tags?.highway;
    if (!highway || !(IMPORTED_HIGHWAY_TAGS as readonly string[]).includes(highway)) continue;
    nodes.push({
      osmNodeId: id,
      latitude: lat as number,
      longitude: lon as number,
      highway,
      direction: tags?.direction ?? null,
      tags: tags ?? {},
    });
  }
  return nodes;
}

/** Just enough of an intersection approach to attach a control to it. */
export interface ApproachLike {
  id: string;
  lat: number;
  lng: number;
  /** Direction of travel through the approach, degrees clockwise from north. */
  bearing: number;
}

export interface AssociationOptions {
  /**
   * Furthest a control may sit ahead of where vehicles stop. A stop line sits
   * back from the node a mapper places at the junction centre, and a queue
   * pushes the cluster further back still.
   */
  maxDistanceMeters: number;
  /** How far the direction to the control may differ from the direction of travel. */
  bearingTolerance: number;
}

export const DEFAULT_ASSOCIATION: AssociationOptions = {
  maxDistanceMeters: 90,
  bearingTolerance: 60,
};

/**
 * The control an approach is stopping for, if any.
 *
 * Distance alone is not enough and getting this wrong is a known bug rather
 * than a hypothetical: both stop lines of an ordinary intersection sit within
 * 60 m of the node, so a proximity test attaches the same signal to the
 * northbound and southbound approaches, and worse, attaches the *opposing*
 * approach's control to this one.
 *
 * What separates them is that a driver stops *before* the control. The signal
 * must therefore lie ahead in the direction of travel -- the bearing from the
 * cluster to the node must agree with the bearing of the approach itself. For
 * the northbound approach the signal is to the north; for the southbound one,
 * to the south. The same node, opposite directions.
 */
export function associateSignal(
  approach: ApproachLike,
  signals: OsmNode[],
  options: AssociationOptions = DEFAULT_ASSOCIATION
): { signal: OsmNode; distance: number } | null {
  let best: { signal: OsmNode; distance: number } | null = null;

  for (const signal of signals) {
    const target = { lat: signal.latitude, lng: signal.longitude };
    const distance = haversineMeters(approach, target);
    if (distance > options.maxDistanceMeters) continue;
    // Degenerate: the node sits on top of the cluster centre, so "ahead" has no
    // meaning. Accept it rather than picking a direction from rounding noise.
    if (distance > 1) {
      const toSignal = bearingToward(approach, target);
      if (bearingDelta(toSignal, approach.bearing) > options.bearingTolerance) continue;
    }
    if (!best || distance < best.distance) best = { signal, distance };
  }

  return best;
}

/** Initial bearing from one position to another, degrees clockwise from north. */
function bearingToward(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The TrafficTagKind an OSM highway tag corresponds to. */
export function kindForHighwayTag(highway: string): 'RED_LIGHT' | 'STOP_SIGN' | null {
  if (highway === 'traffic_signals') return 'RED_LIGHT';
  if (highway === 'stop') return 'STOP_SIGN';
  return null;
}
