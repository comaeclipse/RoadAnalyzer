import { describe, it, expect } from 'vitest';
import { dedupeHeatmapSegments } from './segment-dedupe';
import type { HeatmapSegment } from '../types/congestion';

const emptyBreakdown = { freeFlow: 0, slow: 0, congested: 0, heavy: 0, gridlock: 0 };

function seg(overrides: Partial<HeatmapSegment> & { name: string; coordinates: [number, number][] }): HeatmapSegment {
  const { coordinates, ...rest } = overrides;
  return {
    segmentId: rest.segmentId ?? Math.random().toString(36).slice(2),
    kind: 'segment',
    geometry: { type: 'LineString', coordinates },
    congestionScore: null,
    eventCount: 0,
    avgSpeed: null,
    severityBreakdown: emptyBreakdown,
    ...rest,
  };
}

// A ~1 km stretch near Pensacola, and a copy shifted by ~0.1 m.
const A = seg({ segmentId: 'a', name: 'Main St', coordinates: [[-87.20, 30.40], [-87.19, 30.40]], eventCount: 2, congestionScore: 30, avgSpeed: 10 });
const A_dup = seg({ segmentId: 'a2', name: 'Main St', coordinates: [[-87.200001, 30.400001], [-87.190001, 30.400001]], eventCount: 6, congestionScore: 70, avgSpeed: 20 });

describe('dedupeHeatmapSegments', () => {
  it('merges same-name coincident copies, event-weighting the stats', () => {
    const result = dedupeHeatmapSegments([A, A_dup]);
    expect(result).toHaveLength(1);
    expect(result[0].eventCount).toBe(8);
    expect(result[0].congestionScore).toBeCloseTo((30 * 2 + 70 * 6) / 8); // 60
    expect(result[0].avgSpeed).toBeCloseTo((10 * 2 + 20 * 6) / 8); // 17.5
  });

  it('does NOT merge overlapping segments with different names (an intersection)', () => {
    const crossing = seg({ name: 'Cross St', coordinates: [[-87.200001, 30.400001], [-87.190001, 30.400001]] });
    expect(dedupeHeatmapSegments([A, crossing])).toHaveLength(2);
  });

  it('does NOT merge same-name adjacent tiles that only touch end-to-end', () => {
    const nextTile = seg({ name: 'Main St', coordinates: [[-87.19, 30.40], [-87.18, 30.40]] });
    expect(dedupeHeatmapSegments([A, nextTile])).toHaveLength(2);
  });

  it('leaves a already-unique set untouched', () => {
    const b = seg({ name: 'Elm St', coordinates: [[-87.30, 30.50], [-87.29, 30.50]] });
    expect(dedupeHeatmapSegments([A, b])).toHaveLength(2);
  });
});
