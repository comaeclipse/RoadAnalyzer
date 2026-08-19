import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import {
  normalizeName,
  tileCell,
  tileEdge,
  tileKeyAt,
  TILE_DEGREES,
  UNNAMED_ROAD,
} from './segment-identity';

const edge = (name: string, coordinates: [number, number][]) => ({
  name,
  geometry: { type: 'LineString' as const, coordinates },
});

const lengthOf = (geometry: GeoJSON.LineString) =>
  turf.length(turf.lineString(geometry.coordinates), { units: 'meters' });

// A stretch near Pensacola, well inside one cell.
const INSIDE_ONE_CELL: [number, number][] = [[-87.2020, 30.4020], [-87.2010, 30.4020]];

describe('tileKeyAt', () => {
  it('gives one key to every position in the same cell of the same road', () => {
    expect(tileKeyAt('Main St', [-87.2020, 30.4020]))
      .toBe(tileKeyAt('Main St', [-87.2010, 30.4021]));
  });

  it('separates two roads through the same cell', () => {
    expect(tileKeyAt('Cross St', [-87.2020, 30.4020]))
      .not.toBe(tileKeyAt('Main St', [-87.2020, 30.4020]));
  });

  it('separates two cells of the same road', () => {
    expect(tileKeyAt('Main St', [-87.2020, 30.4020]))
      .not.toBe(tileKeyAt('Main St', [-87.2020, 30.4020 + TILE_DEGREES]));
  });

  it('normalises case and whitespace in the name', () => {
    expect(tileKeyAt('  MAIN   St ', [-87.2020, 30.4020]))
      .toBe(tileKeyAt('Main St', [-87.2020, 30.4020]));
  });

  it('refuses to identify an unnamed road', () => {
    expect(tileKeyAt(UNNAMED_ROAD, [-87.2020, 30.4020])).toBeNull();
    expect(tileKeyAt('', [-87.2020, 30.4020])).toBeNull();
  });
});

describe('tileEdge', () => {
  it('gives two matches of one stretch the same tiles, whatever their extent', () => {
    // This is the case the endpoint-based key could not handle: one drive
    // matched 4 km of the road, another only the middle 1 km of it.
    const long = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]));
    const short = tileEdge(edge('Main St', [[-87.2100, 30.4000], [-87.2000, 30.4000]]));

    expect(short.length).toBeGreaterThan(0);
    const longKeys = new Set(long.map((tile) => tile.key));
    for (const tile of short) expect(longKeys.has(tile.key)).toBe(true);
  });

  it('does not care which way the road was driven', () => {
    const forward = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]));
    const backward = tileEdge(edge('Main St', [[-87.1800, 30.4000], [-87.2200, 30.4000]]));
    expect(new Set(backward.map((t) => t.key))).toEqual(new Set(forward.map((t) => t.key)));
  });

  it('files a stretch inside one cell as a single tile', () => {
    const tiles = tileEdge(edge('Main St', INSIDE_ONE_CELL));
    expect(tiles).toHaveLength(1);
    expect(tiles[0].key).toBe(tileKeyAt('Main St', INSIDE_ONE_CELL[0]));
  });

  it('cuts a long road into one tile per cell it crosses', () => {
    // 0.04 degrees of longitude at 8 cells of 0.005.
    const tiles = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]));
    expect(tiles).toHaveLength(8);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(8);
  });

  it('leaves no gap between adjacent tiles', () => {
    const tiles = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]))
      .sort((a, b) => a.geometry.coordinates[0][0] - b.geometry.coordinates[0][0]);
    for (let i = 1; i < tiles.length; i++) {
      const previousEnd = tiles[i - 1].geometry.coordinates.at(-1)!;
      const nextStart = tiles[i].geometry.coordinates[0];
      const gap = turf.distance(turf.point(previousEnd), turf.point(nextStart), { units: 'meters' });
      // They share the crossing point, so the tiles overlap slightly rather
      // than leaving the boundary uncovered.
      expect(gap).toBeLessThanOrEqual(2 * 10);
      expect(previousEnd[0]).toBeGreaterThanOrEqual(nextStart[0] - 1e-9);
    }
  });

  it('registers every cell a long straight run passes through', () => {
    // Two vertices, 4 km apart, no intermediate geometry to hint at the cells
    // in between. The keys must be a contiguous run of cells, with none skipped.
    const tiles = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]));
    const cells = tiles.map((t) => Number(t.key.split('|')[1].split(':')[1])).sort((a, b) => a - b);
    for (let i = 1; i < cells.length; i++) expect(cells[i] - cells[i - 1]).toBe(1);
  });

  it('does not file a tile for a cell the road only touches', () => {
    // -87.1800 is exactly a cell boundary, so the road ends on the edge of the
    // next cell without entering it.
    const tiles = tileEdge(edge('Main St', [[-87.2200, 30.4000], [-87.1800, 30.4000]]));
    expect(tiles.some((t) => t.key === tileKeyAt('Main St', [-87.1800, 30.4000]))).toBe(false);
  });

  it('keeps the longer pass when a road leaves a cell and returns', () => {
    // Out of the cell and back, with the second pass much shorter.
    const tiles = tileEdge(edge('Main St', [
      [-87.2020, 30.4020], [-87.2020, 30.4080], [-87.2015, 30.4020], [-87.2014, 30.4021],
    ]));
    const home = tiles.filter((t) => t.key === tileKeyAt('Main St', [-87.2020, 30.4020]));
    expect(home).toHaveLength(1);
    expect(lengthOf(home[0].geometry)).toBeGreaterThan(100);
  });

  it('gives an unnamed edge no tiles at all', () => {
    expect(tileEdge(edge(UNNAMED_ROAD, INSIDE_ONE_CELL))).toEqual([]);
  });

  it('gives a degenerate geometry no tiles', () => {
    // Stored rows include zero-length artifacts; a tile for one would describe
    // nowhere.
    expect(tileEdge(edge('Main St', [[-87.2020, 30.4020], [-87.20200001, 30.40200001]]))).toEqual([]);
  });

  it('gives geometry that is not a line no tiles', () => {
    expect(tileEdge(edge('Main St', [[-87.2020, 30.4020]]))).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeName('  NW   17th  Ave ')).toBe('nw 17th ave');
  });
});
