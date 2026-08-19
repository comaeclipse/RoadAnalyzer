import { describe, expect, it, vi } from 'vitest';
import {
  chunkTrace,
  matchTrace,
  prepareTrace,
  type MatchInputPoint,
} from './map-matching';
import { analyzeDirections, cardinalDirection } from './trip-directions';

function point(index: number, overrides: Partial<MatchInputPoint> = {}): MatchInputPoint {
  return {
    id: `point-${index}`,
    latitude: 30 + index * 0.0001,
    longitude: -87 + index * 0.0001,
    timestamp: index * 1_000,
    accuracy: 10,
    heading: 90,
    ...overrides,
  };
}

describe('trace preparation', () => {
  it('filters inaccurate points and preserves endpoints and material course changes', () => {
    const prepared = prepareTrace([
      point(0),
      point(1, { accuracy: 80 }),
      point(2),
      point(3, { heading: 180 }),
      point(4),
      point(6),
    ]);
    expect(prepared.map((item) => item.id)).toEqual(['point-0', 'point-3', 'point-4', 'point-6']);
  });

  it('chunks at 100 points with five-point overlap', () => {
    const prepared = prepareTrace(Array.from({ length: 600 }, (_, index) =>
      point(index, { timestamp: index * 5_000 })
    ));
    const chunks = chunkTrace(prepared);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks[0].slice(-5).map((item) => item.id))
      .toEqual(chunks[1].slice(0, 5).map((item) => item.id));
  });

  it('never chunks across a pause, so Mapbox cannot route the gap', () => {
    // 5 s apart, so prepareTrace keeps every point.
    const points = Array.from({ length: 8 }, (_, index) => point(index, { timestamp: index * 5_000 }));
    const prepared = prepareTrace(points);
    const chunks = chunkTrace(prepared, [{ startedAt: 16_000, endedAt: 19_000 }]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].map((item) => item.id)).toEqual(['point-0', 'point-1', 'point-2', 'point-3']);
    expect(chunks[1].map((item) => item.id)).toEqual(['point-4', 'point-5', 'point-6', 'point-7']);
  });

  it('drops points recorded inside a pause', () => {
    const points = Array.from({ length: 8 }, (_, index) => point(index, { timestamp: index * 5_000 }));
    const prepared = prepareTrace(points);
    // Wide enough to swallow point-3 and point-4 outright.
    const chunks = chunkTrace(prepared, [{ startedAt: 15_000, endedAt: 20_000 }]);

    expect(chunks.flat().map((item) => item.id)).not.toContain('point-3');
    expect(chunks.flat().map((item) => item.id)).not.toContain('point-4');
  });

  it('leaves an unpaused trace in one piece', () => {
    const prepared = prepareTrace(Array.from({ length: 8 }, (_, index) => point(index, { timestamp: index * 5_000 })));
    expect(chunkTrace(prepared, [])).toHaveLength(1);
    expect(chunkTrace(prepared)).toHaveLength(1);
  });
});

describe('Mapbox normalization', () => {
  it('normalizes geometry, OpenLR edges, tracepoints, and meaningful maneuvers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 'Ok',
      matchings: [{
        confidence: 0.9,
        distance: 100,
        geometry: {
          type: 'LineString',
          coordinates: [[-87, 30], [-86.9999, 30.0001], [-86.9998, 30.0002]],
        },
        linear_references: ['edge-a', 'edge-b'],
        legs: [{
          steps: [
            { name: 'First Road', maneuver: { type: 'depart', instruction: 'Depart', location: [-87, 30] } },
            { name: 'Second Road', maneuver: { type: 'turn', modifier: 'right', instruction: 'Turn right', location: [-86.9999, 30.0001], bearing_before: 0, bearing_after: 90 } },
            { name: 'Second Road', maneuver: { type: 'arrive', instruction: 'Arrive', location: [-86.9998, 30.0002] } },
          ],
        }],
      }],
      tracepoints: [
        { location: [-87, 30], name: 'First Road', matchings_index: 0, alternatives_count: 0 },
        { location: [-86.9998, 30.0002], name: 'Second Road', matchings_index: 0, alternatives_count: 0 },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await matchTrace(
      [point(0), point(5)],
      { token: 'test-token', fetchImpl }
    );
    expect(result.edges.map((edge) => edge.sourceId)).toEqual(['edge-a', 'edge-b']);
    expect(result.maneuvers).toHaveLength(1);
    expect(result.maneuvers[0]).toMatchObject({ turnType: 'right', angleDegrees: 90 });
    expect(result.coverage).toBe(1);
  });

  it('marks NoMatch as non-retryable and rate limits as retryable', async () => {
    const noMatch = vi.fn(async () => new Response(JSON.stringify({ code: 'NoMatch' }), { status: 200 })) as unknown as typeof fetch;
    await expect(matchTrace([point(0), point(5)], { token: 'x', fetchImpl: noMatch }))
      .rejects.toMatchObject({ code: 'NO_MATCH', retryable: false });

    const rateLimited = vi.fn(async () => new Response(JSON.stringify({ code: 'RateLimit' }), { status: 429 })) as unknown as typeof fetch;
    await expect(matchTrace([point(0), point(5)], { token: 'x', fetchImpl: rateLimited }))
      .rejects.toMatchObject({ code: 'RateLimit', retryable: true });
  });
});

describe('direction analysis', () => {
  it('classifies bearings and weights the dominant direction by distance', () => {
    expect(cardinalDirection(0)).toBe('NORTH');
    expect(cardinalDirection(90)).toBe('EAST');
    const result = analyzeDirections({
      type: 'LineString',
      coordinates: [[-87, 30], [-86.99, 30], [-86.99, 30.001]],
    });
    expect(result.dominantDirection).toBe('EAST');
    expect(result.directionBreakdown.east).toBeGreaterThan(result.directionBreakdown.north);
  });

  it('does not report a misleading net direction for a closed loop', () => {
    const result = analyzeDirections({
      type: 'LineString',
      coordinates: [[-87, 30], [-86.999, 30], [-87, 30]],
    });
    expect(result.netDirection).toBeNull();
    expect(result.dominantDirection).not.toBeNull();
  });
});
