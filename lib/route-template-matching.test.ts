import { describe, expect, it } from 'vitest';
import {
  matchRouteTemplate,
  ROUTE_MATCH_THRESHOLD,
  type TemplateSignature,
} from './route-template-matching';
import type { RouteStep } from './route-signature';

const step = (segmentId: string, meters: number): RouteStep =>
  ({ segmentId, meters, sampleCount: Math.max(1, Math.round(meters / 30)) });

/** A line running east along one latitude, long enough for the geometry path. */
const line = (fromLng: number, toLng: number): GeoJSON.LineString => ({
  type: 'LineString',
  coordinates: Array.from({ length: 40 }, (_, index) => [
    fromLng + ((toLng - fromLng) * index) / 39,
    30.4,
  ]),
});

const COMMUTE = [step('a', 3000), step('b', 3000), step('c', 3000), step('d', 3000)];

const template = (overrides: Partial<TemplateSignature> = {}): TemplateSignature => ({
  id: 'template-commute',
  geometry: line(-87.22, -87.10),
  distance: 12_000,
  direction: 'NORTH',
  steps: COMMUTE,
  ...overrides,
});

describe('matchRouteTemplate', () => {
  it('matches an identical drive by its sequence', () => {
    const match = matchRouteTemplate(
      { steps: COMMUTE, geometry: line(-87.22, -87.10), distance: 12_000, direction: 'NORTH' },
      [template()]
    );
    expect(match?.method).toBe('sequence');
    expect(match?.score).toBe(1);
    expect(match?.divergence).toBeNull();
  });

  it('matches a drive that took a short detour, and says where', () => {
    const detour = [step('a', 3000), step('b', 3000), step('x', 400), step('d', 3000)];
    const match = matchRouteTemplate(
      { steps: detour, geometry: line(-87.22, -87.10), distance: 9_400, direction: 'NORTH' },
      [template()]
    );
    expect(match?.method).toBe('sequence');
    expect(match?.divergence).toEqual({ at: 2, left: 'x', right: 'c' });
  });

  it('refuses to force a genuinely new route onto an existing template', () => {
    // The failure mode that quietly corrupts per-route statistics: it shares
    // the first road and nothing else.
    const novel = [step('a', 3000), step('p', 3000), step('q', 3000), step('r', 3000)];
    const match = matchRouteTemplate(
      { steps: novel, geometry: line(-87.22, -87.10), distance: 12_000, direction: 'NORTH' },
      [template()]
    );
    expect(match).toBeNull();
  });

  it('does not match a route driven the other way, without a direction gate', () => {
    const reversed = [...COMMUTE].reverse();
    const match = matchRouteTemplate(
      { steps: reversed, geometry: line(-87.22, -87.10), distance: 12_000, direction: null },
      [template({ direction: null })]
    );
    expect(match).toBeNull();
  });

  it('ignores a cardinal direction that disagrees when the roads agree', () => {
    // A trace whose dominant direction comes out differently is still the same
    // route if it used the same roads in the same order.
    const match = matchRouteTemplate(
      { steps: COMMUTE, geometry: line(-87.22, -87.10), distance: 12_000, direction: 'WEST' },
      [template({ direction: 'SOUTH' })]
    );
    expect(match?.method).toBe('sequence');
  });

  it('falls back to geometry when the drive has almost no matched segments', () => {
    const match = matchRouteTemplate(
      { steps: [step('a', 200)], geometry: line(-87.22, -87.10), distance: 12_000, direction: 'NORTH' },
      [template()]
    );
    expect(match?.method).toBe('geometry');
    expect(match?.templateId).toBe('template-commute');
    expect(match?.score).toBeNull();
  });

  it('falls back to geometry when the sequence covers too little of the drive', () => {
    // Three steps, but they account for a mile of a twelve-kilometre drive:
    // the rest of the journey could have gone anywhere.
    const sparse = [step('a', 500), step('b', 500), step('c', 500)];
    const match = matchRouteTemplate(
      { steps: sparse, geometry: line(-87.22, -87.10), distance: 12_000, direction: 'NORTH' },
      [template()]
    );
    expect(match?.method).toBe('geometry');
  });

  it('returns nothing when neither path can place the drive', () => {
    const match = matchRouteTemplate(
      { steps: [step('a', 100)], geometry: line(-87.60, -87.50), distance: 12_000, direction: 'NORTH' },
      [template()]
    );
    expect(match).toBeNull();
  });

  it('picks the closest template when several clear the bar', () => {
    const near = template({ id: 'near', steps: [step('a', 3000), step('b', 3000), step('c', 3000), step('z', 3000)] });
    const exact = template({ id: 'exact' });
    expect(matchRouteTemplate(
      { steps: COMMUTE, geometry: line(-87.22, -87.10), distance: 12_000, direction: 'NORTH' },
      [near, exact]
    )?.templateId).toBe('exact');
  });

  it('keeps the threshold inside the gap the real data showed', () => {
    // Genuine matches scored 0.50 and up across 30 drives; everything else
    // scored 0.36 or less.
    expect(ROUTE_MATCH_THRESHOLD).toBeGreaterThan(0.36);
    expect(ROUTE_MATCH_THRESHOLD).toBeLessThan(0.50);
  });
});
