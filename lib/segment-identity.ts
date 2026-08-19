/**
 * Stable identity for a stretch of road.
 *
 * `RoadSegment` rows were keyed on Mapbox's OpenLR `linear_references`, which
 * are not stable across requests: the same road matched twice comes back with a
 * different reference, so every re-drive filed a new row. 144 rows for 33 roads,
 * "New Warrington Road" alone with 26, and lib/segment-dedupe.ts collapsing them
 * again on every read.
 *
 * The first attempt at a fix keyed on the road name plus its two endpoints,
 * rounded to a grid. That does not work here, and the dry run said so: Mapbox
 * returns whatever extent a drive covered, so those 26 rows run from 671 m to
 * 7615 m over the same corridor, each starting and ending wherever the trace
 * entered and left the road. Their endpoints differ by hundreds of metres to
 * kilometres. No rounding merges them; the coarseness required would merge
 * different roads instead.
 *
 * So identity does not come from the matched extent at all. A road is cut into
 * fixed tiles by a grid laid over the world, and a segment is one tile of one
 * road. Whatever extent a drive matches, it lands on the same tiles as every
 * other drive over the same ground. That makes identity:
 *
 *   - deterministic, so it can be a unique constraint, which makes it race-safe:
 *     two concurrent analyses of one road compute the same keys and the
 *     constraint collapses them, where a "find a nearby segment, else insert"
 *     query has a window in which both find nothing and both insert;
 *   - independent of how far a drive happened to travel;
 *   - stable over time. The row count tracks the road-kilometres covered rather
 *     than the number of drives, so re-driving a commute adds no rows.
 *
 * The cost is more rows than the duplicate-collapsing approach would leave
 * (~330 rather than ~58), and tile boundaries that fall wherever the grid says
 * rather than at junctions. In exchange the count stops growing with use.
 */

/** The parts of a matched edge that identity depends on. */
export interface IdentifiableEdge {
  name: string;
  geometry: GeoJSON.LineString;
}

/** One tile of one road: the piece of `edge` lying inside a single grid cell. */
export interface SegmentTile {
  key: string;
  geometry: GeoJSON.LineString;
}

/**
 * Grid pitch in degrees. About 557 m of latitude — close to the link lengths
 * traffic analysis usually works in, long enough that a signal queue sits
 * inside one tile rather than smeared across several, and short enough that a
 * tile describes somewhere specific rather than a whole corridor.
 */
export const TILE_DEGREES = 0.005;

/**
 * Spacing at which a geometry is sampled when working out which tiles it
 * crosses. Small relative to the grid, so a straight run between two distant
 * vertices still registers every cell it passes through.
 */
const WALK_STEP_METERS = 10;

/**
 * Shortest piece of road that earns a tile of its own. Below this the "tile" is
 * an artifact — a road clipping the corner of a cell, or a degenerate stored
 * geometry with no length at all — and would become a segment row describing
 * nowhere. Samples there file against the nearest real tile of the same road.
 */
const MIN_TILE_METERS = 5;

/**
 * Mapbox's fallback when a matched edge has no street name.
 *
 * Unnamed edges are never given a key. Two unrelated stubs in one cell would
 * otherwise merge into a single "road", and there is nothing in the data to
 * tell them apart.
 */
export const UNNAMED_ROAD = 'Unnamed road';

/** Lowercased, with runs of whitespace collapsed, so "  NW  17th " matches "NW 17th". */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Grid cell containing a position, as integer indices. */
export function tileCell(position: GeoJSON.Position): { x: number; y: number } {
  return {
    x: Math.floor(position[0] / TILE_DEGREES),
    y: Math.floor(position[1] / TILE_DEGREES),
  };
}

/**
 * Identity of the tile of `name` containing `position`, or null when the road
 * cannot be identified. This is the lookup used to file a GPS sample: whichever
 * tile its snapped position falls in is the segment it belongs to.
 */
export function tileKeyAt(name: string, position: GeoJSON.Position): string | null {
  const normalized = normalizeName(name ?? '');
  if (!normalized || normalized === normalizeName(UNNAMED_ROAD)) return null;
  const { x, y } = tileCell(position);
  return `${normalized}|${y}:${x}`;
}

function interpolate(a: GeoJSON.Position, b: GeoJSON.Position, fraction: number): GeoJSON.Position {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

function runLength(positions: GeoJSON.Position[]): number {
  let total = 0;
  for (let i = 1; i < positions.length; i++) total += approximateMeters(positions[i - 1], positions[i]);
  return total;
}

/** Rough metres between two nearby positions; only used to pace the walk. */
function approximateMeters(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const latitudeMeters = (b[1] - a[1]) * 111_320;
  const longitudeMeters = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

/**
 * Cut an edge into the tiles it covers.
 *
 * The line is walked at a fine step so that no crossed cell is skipped, and a
 * run ends when the cell changes. Consecutive runs share the crossing point, so
 * the tiles join up rather than leaving a gap at every boundary.
 *
 * A road that leaves a cell and comes back later yields two runs for one key;
 * the longer is kept, since a tile holds one geometry and the longer piece
 * describes the road through that cell better.
 */
export function tileEdge(edge: IdentifiableEdge): SegmentTile[] {
  const coordinates = edge.geometry?.coordinates ?? [];
  if (coordinates.length < 2) return [];
  if (tileKeyAt(edge.name, coordinates[0]) === null) return [];

  // Walk the line at WALK_STEP_METERS, keeping the original vertices so the
  // tile geometry still follows the road's real shape.
  const walked: GeoJSON.Position[] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const previous = coordinates[i - 1];
    const current = coordinates[i];
    const steps = Math.floor(approximateMeters(previous, current) / WALK_STEP_METERS);
    for (let step = 1; step <= steps; step++) {
      walked.push(interpolate(previous, current, step / (steps + 1)));
    }
    walked.push(current);
  }

  interface Run {
    key: string;
    positions: GeoJSON.Position[];
    /** Points lying in this run's own cell, excluding the carried-in crossing. */
    own: number;
  }
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const position of walked) {
    const key = tileKeyAt(edge.name, position)!;
    if (current && current.key === key) {
      current.positions.push(position);
      current.own++;
      continue;
    }
    if (current) {
      // Carry the crossing into both tiles so neither stops short of the
      // boundary. The carried point belongs to the neighbour's cell, which is
      // why it does not count towards `own`.
      current.positions.push(position);
      runs.push(current);
      current = { key, positions: [current.positions[current.positions.length - 2], position], own: 1 };
    } else {
      current = { key, positions: [position], own: 1 };
    }
  }
  if (current) runs.push(current);

  const longest = new Map<string, GeoJSON.Position[]>();
  for (const run of runs) {
    // A road that merely touches a cell -- typically because it ends exactly on
    // a boundary -- has no extent there and would otherwise become a segment
    // row a few metres long.
    if (run.own < 2 || run.positions.length < 2) continue;
    if (runLength(run.positions) < MIN_TILE_METERS) continue;
    const existing = longest.get(run.key);
    if (!existing || run.positions.length > existing.length) longest.set(run.key, run.positions);
  }

  return Array.from(longest, ([key, positions]) => ({
    key,
    geometry: { type: 'LineString' as const, coordinates: positions },
  }));
}
