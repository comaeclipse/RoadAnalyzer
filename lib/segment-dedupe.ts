import * as turf from '@turf/turf';
import type { HeatmapSegment } from '@/types/congestion';

/**
 * Collapse redundant road-segment rows before they reach the map.
 *
 * RoadSegment identity is keyed on Mapbox `linear_references`, which are not
 * stable across drives: the same physical stretch can come back with a
 * different reference on a later drive, creating a fresh row with the same
 * name and near-identical geometry. Those pile up on the heatmap.
 *
 * We merge two segments only when they are BOTH the same name AND spatially
 * coincident. Same-name-only would fuse the distinct stretches that tile one
 * long road; geometry-only would fuse different roads that meet at an
 * intersection. Requiring both is the safe key.
 */

const COINCIDENT_METERS = 15;
// Skip the expensive overlap test unless the segment midpoints are at least
// this close — a cheap reject for the O(n^2) pairing.
const MIDPOINT_PREFILTER_METERS = 400;

type Geo = GeoJSON.LineString;

function midpoint(geo: Geo): [number, number] {
  return geo.coordinates[Math.floor(geo.coordinates.length / 2)] as [number, number];
}

/** Mean distance (m) from each vertex of `a` to the nearest point on line `b`. */
function meanVertexDistance(a: Geo, b: Geo): number {
  const line = turf.lineString(b.coordinates);
  let sum = 0;
  for (const coordinate of a.coordinates) {
    const snapped = turf.nearestPointOnLine(line, turf.point(coordinate), { units: 'meters' });
    sum += Number(snapped.properties.dist ?? 0);
  }
  return sum / a.coordinates.length;
}

/** Same physical stretch: same name and geometries lying on top of each other. */
function coincident(a: HeatmapSegment, b: HeatmapSegment): boolean {
  if (a.name !== b.name) return false;
  if (a.geometry.coordinates.length < 2 || b.geometry.coordinates.length < 2) return false;
  const gap = turf.distance(turf.point(midpoint(a.geometry)), turf.point(midpoint(b.geometry)), { units: 'meters' });
  if (gap > MIDPOINT_PREFILTER_METERS) return false;
  // Overlap relative to the shorter line — a short piece sitting on a long road
  // still counts as the same stretch.
  return Math.min(meanVertexDistance(a.geometry, b.geometry), meanVertexDistance(b.geometry, a.geometry)) < COINCIDENT_METERS;
}

function lengthMeters(geo: Geo): number {
  return geo.coordinates.length < 2 ? 0 : turf.length(turf.lineString(geo.coordinates), { units: 'meters' });
}

/** Event-weighted merge of one cluster of coincident segments into a single row. */
function mergeCluster(cluster: HeatmapSegment[]): HeatmapSegment {
  if (cluster.length === 1) return cluster[0];

  // Represent the cluster with its longest geometry (and that row's id/name).
  const representative = cluster.reduce((best, item) =>
    lengthMeters(item.geometry) > lengthMeters(best.geometry) ? item : best
  );

  const totalEvents = cluster.reduce((sum, item) => sum + item.eventCount, 0);
  // Weight by event count so busier copies dominate the blend; fall back to
  // equal weights when a cluster has no events at all.
  const weightOf = (item: HeatmapSegment) => (totalEvents > 0 ? item.eventCount : 1);
  const totalWeight = cluster.reduce((sum, item) => sum + weightOf(item), 0);

  const weightedMean = (pick: (item: HeatmapSegment) => number | null): number | null => {
    let weight = 0;
    let acc = 0;
    for (const item of cluster) {
      const value = pick(item);
      if (value == null) continue;
      acc += value * weightOf(item);
      weight += weightOf(item);
    }
    return weight > 0 ? acc / weight : null;
  };

  const breakdownKeys = ['freeFlow', 'slow', 'congested', 'heavy', 'gridlock'] as const;
  const severityBreakdown = Object.fromEntries(
    breakdownKeys.map((key) => [key, (weightedMean((item) => item.severityBreakdown[key]) ?? 0)])
  ) as HeatmapSegment['severityBreakdown'];

  return {
    segmentId: representative.segmentId,
    name: representative.name,
    kind: 'segment',
    geometry: representative.geometry,
    congestionScore: weightedMean((item) => item.congestionScore),
    eventCount: totalEvents,
    avgSpeed: weightedMean((item) => item.avgSpeed),
    severityBreakdown,
  };
}

/**
 * Merge coincident duplicate segments. Non-segment items are returned
 * untouched. Greedy single-link clustering keyed on (name, geometry overlap).
 */
export function dedupeHeatmapSegments(segments: HeatmapSegment[]): HeatmapSegment[] {
  const clusters: HeatmapSegment[][] = [];
  for (const segment of segments) {
    const existing = clusters.find((cluster) => cluster.some((member) => coincident(member, segment)));
    if (existing) existing.push(segment);
    else clusters.push([segment]);
  }
  return clusters.map(mergeCluster);
}
