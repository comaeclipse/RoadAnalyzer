import { describe, expect, it } from 'vitest';
import { normalizeName, spatialKeyFor, UNNAMED_ROAD } from './segment-identity';

const edge = (name: string, coordinates: [number, number][]) => ({
  name,
  geometry: { type: 'LineString' as const, coordinates },
});

// The same ~1 km stretch near Pensacola used by the read-layer dedupe tests, so
// the two mechanisms can be compared on identical cases.
const MAIN: [number, number][] = [[-87.20, 30.40], [-87.19, 30.40]];
const MAIN_JITTERED: [number, number][] = [[-87.200001, 30.400001], [-87.190001, 30.400001]];

describe('spatialKeyFor', () => {
  it('gives two matches of one stretch the same key', () => {
    expect(spatialKeyFor(edge('Main St', MAIN_JITTERED)))
      .toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('separates two roads that merely cross at an intersection', () => {
    expect(spatialKeyFor(edge('Cross St', MAIN_JITTERED)))
      .not.toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('separates adjacent tiles of one long road', () => {
    const nextTile: [number, number][] = [[-87.19, 30.40], [-87.18, 30.40]];
    expect(spatialKeyFor(edge('Main St', nextTile)))
      .not.toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('does not care which way the stretch was driven', () => {
    const reversed = [...MAIN].reverse() as [number, number][];
    expect(spatialKeyFor(edge('Main St', reversed)))
      .toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('ignores the vertices between the endpoints', () => {
    // Two matches of one stretch rarely agree on intermediate vertices; only
    // where the stretch begins and ends should decide identity.
    const denser: [number, number][] = [[-87.20, 30.40], [-87.195, 30.400002], [-87.19, 30.40]];
    expect(spatialKeyFor(edge('Main St', denser)))
      .toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('normalises case and whitespace in the name', () => {
    expect(spatialKeyFor(edge('  MAIN   St ', MAIN)))
      .toBe(spatialKeyFor(edge('Main St', MAIN)));
  });

  it('refuses to identify an unnamed edge', () => {
    expect(spatialKeyFor(edge(UNNAMED_ROAD, MAIN))).toBeNull();
    expect(spatialKeyFor(edge('', MAIN))).toBeNull();
  });

  it('refuses an edge too short to have distinct endpoints', () => {
    expect(spatialKeyFor(edge('Main St', [[-87.20, 30.40], [-87.200001, 30.400001]]))).toBeNull();
  });

  it('refuses geometry that is not a line', () => {
    expect(spatialKeyFor(edge('Main St', [[-87.20, 30.40]]))).toBeNull();
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeName('  NW   17th  Ave ')).toBe('nw 17th ave');
  });
});
