/**
 * Stable identity for a stretch of road.
 *
 * `RoadSegment` rows are keyed on Mapbox's OpenLR `linear_references`, which
 * are not stable across requests: the same stretch driven again comes back with
 * a different reference — sub-metre snapping differs, the direction of travel
 * differs, a chunk boundary falls elsewhere — so the unique key treats every
 * re-drive as a new road. The rows pile up, per-segment history fragments, and
 * lib/segment-dedupe.ts has to collapse them again on every read.
 *
 * A spatial key fixes it at the write. It is a pure function of the edge, which
 * makes it race-safe in a way a "look for a nearby segment, else insert" query
 * cannot be: two drives ingesting the same road concurrently compute the same
 * key, and the unique constraint collapses them rather than both finding
 * nothing and both inserting.
 *
 * The known weakness is the grid: two copies of a stretch straddling a rounding
 * boundary get different keys and stay separate. Coarse rounding keeps that
 * rare, and the read-layer dedupe remains as the net.
 */

/** The parts of a matched edge that identity depends on. */
export interface IdentifiableEdge {
  name: string;
  geometry: GeoJSON.LineString;
}

/**
 * Decimal places kept on each endpoint. Four is about 11 m of latitude — coarse
 * enough to absorb the snapping jitter between two matches of one road, fine
 * enough that the separate stretches tiling a long road keep their own keys.
 */
export const SPATIAL_KEY_PRECISION = 4;

/**
 * Mapbox's fallback when a matched edge has no street name.
 *
 * Unnamed edges are never merged: the name carries most of the discriminating
 * power in this key, and without it two unrelated stubs that happen to start
 * and end on the same 11 m squares would collapse into one road.
 */
export const UNNAMED_ROAD = 'Unnamed road';

/** Lowercased, with runs of whitespace collapsed, so "  NW  17th " matches "NW 17th". */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function roundedEndpoint(position: GeoJSON.Position): string {
  return `${position[0].toFixed(SPATIAL_KEY_PRECISION)},${position[1].toFixed(SPATIAL_KEY_PRECISION)}`;
}

/**
 * Deterministic key for the physical stretch an edge covers, or null when the
 * edge cannot be identified safely and should keep falling back to `sourceId`.
 *
 * Endpoints are sorted, so a stretch encoded start→end and the same stretch
 * encoded end→start produce one key. That makes segments direction-agnostic,
 * which is what they already are everywhere else in the pipeline; telling
 * northbound congestion from southbound would mean putting a bearing bucket in
 * here, and that is a change to the data model rather than a dedupe.
 */
export function spatialKeyFor(edge: IdentifiableEdge): string | null {
  const name = normalizeName(edge.name ?? '');
  if (!name || name === normalizeName(UNNAMED_ROAD)) return null;

  const coordinates = edge.geometry?.coordinates ?? [];
  if (coordinates.length < 2) return null;

  const endpoints = [
    roundedEndpoint(coordinates[0]),
    roundedEndpoint(coordinates[coordinates.length - 1]),
  ].sort();

  // A stretch whose endpoints round onto the same square has no length to
  // speak of at this precision; keying it would merge every stub at that
  // corner into one segment.
  if (endpoints[0] === endpoints[1]) return null;

  return `${name}|${endpoints.join(';')}`;
}
