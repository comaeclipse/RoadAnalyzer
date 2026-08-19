import { describe, expect, it } from 'vitest';
import { routeLength, routeSimilarity, routeSteps, type MatchedSample, type RouteStep } from './route-signature';

const at = (segmentId: string, timestamp: number, distanceFromPrev = 30): MatchedSample =>
  ({ segmentId, timestamp, distanceFromPrev });

const step = (segmentId: string, meters: number): RouteStep =>
  ({ segmentId, meters, sampleCount: Math.max(1, Math.round(meters / 30)) });

describe('routeSteps', () => {
  it('collapses a run of samples on one segment into one step', () => {
    const steps = routeSteps([at('a', 1), at('a', 2), at('a', 3), at('b', 4)]);
    expect(steps.map((s) => s.segmentId)).toEqual(['a', 'b']);
    expect(steps[0].sampleCount).toBe(3);
    expect(steps[0].meters).toBe(90);
  });

  it('orders by timestamp, not by row order', () => {
    const steps = routeSteps([at('c', 30), at('a', 10), at('b', 20)]);
    expect(steps.map((s) => s.segmentId)).toEqual(['a', 'b', 'c']);
  });

  it('does not invent an alternation when matching flaps at a boundary', () => {
    // The nearest tile flips for a couple of fixes as the drive crosses from a
    // to b. It crossed once.
    const steps = routeSteps([
      at('a', 1), at('a', 2), at('a', 3),
      at('b', 4, 8), at('a', 5, 8), at('b', 6, 8), at('a', 7, 8),
      at('b', 8), at('b', 9), at('b', 10),
    ]);
    expect(steps.map((s) => s.segmentId)).toEqual(['a', 'b']);
  });

  it('keeps a real revisit, because a loop is not an out-and-back', () => {
    const steps = routeSteps([
      at('a', 1), at('a', 2), at('a', 3),
      at('b', 4), at('b', 5), at('b', 6),
      at('a', 7), at('a', 8), at('a', 9),
    ]);
    expect(steps.map((s) => s.segmentId)).toEqual(['a', 'b', 'a']);
  });

  it('keeps a short connector between two different roads', () => {
    // Short, but not flapping: it goes somewhere.
    const steps = routeSteps([at('a', 1), at('link', 2, 12), at('b', 3)]);
    expect(steps.map((s) => s.segmentId)).toEqual(['a', 'link', 'b']);
  });

  it('measures the ground a sequence covers', () => {
    expect(routeLength([step('a', 100), step('b', 250)])).toBe(350);
  });
});

describe('routeSimilarity', () => {
  const commute = [step('18', 1000), step('24', 1000), step('31', 1000), step('42', 1000), step('57', 1000), step('61', 1000)];

  it('scores an identical route 1', () => {
    expect(routeSimilarity(commute, commute).score).toBe(1);
    expect(routeSimilarity(commute, commute).divergence).toBeNull();
  });

  it('scores a partly shared route high, and says where it parted', () => {
    const variant = [step('18', 1000), step('24', 1000), step('83', 1000), step('91', 1000), step('110', 1000), step('61', 1000)];
    const result = routeSimilarity(commute, variant);
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.score).toBeLessThan(1);
    expect(result.divergence).toEqual({ at: 2, left: '31', right: '83' });
  });

  it('scores disjoint routes near zero', () => {
    const elsewhere = [step('900', 1000), step('901', 1000), step('902', 1000)];
    expect(routeSimilarity(commute, elsewhere).score).toBe(0);
  });

  it('prefers a short detour over a long divergence', () => {
    // The property the old point-counting got wrong: both of these have the
    // same number of differing steps, but one abandons half the route.
    const shortDetour = [step('18', 1000), step('24', 1000), step('99', 200), step('42', 1000), step('57', 1000), step('61', 1000)];
    const longDivergence = [step('18', 1000), step('24', 1000), step('99', 3000)];
    expect(routeSimilarity(commute, shortDetour).score)
      .toBeGreaterThan(routeSimilarity(commute, longDivergence).score);
  });

  it('weights by distance, so short stubs cannot outvote the arterial', () => {
    const arterial = [step('main', 9000), step('x', 100), step('y', 100), step('z', 100)];
    const sameArterial = [step('main', 9000), step('p', 100), step('q', 100), step('r', 100)];
    const differentArterial = [step('other', 9000), step('x', 100), step('y', 100), step('z', 100)];
    expect(routeSimilarity(arterial, sameArterial).score)
      .toBeGreaterThan(routeSimilarity(arterial, differentArterial).score);
  });

  it('does not call the same roads in a different order the same route', () => {
    const reversed = [...commute].reverse();
    expect(routeSimilarity(commute, reversed).score).toBeLessThan(0.5);
  });

  it('is symmetric', () => {
    const variant = [step('18', 1000), step('24', 800), step('83', 1200), step('61', 900)];
    expect(routeSimilarity(commute, variant).score)
      .toBeCloseTo(routeSimilarity(variant, commute).score);
  });

  it('scores an empty sequence zero rather than dividing by nothing', () => {
    expect(routeSimilarity([], commute).score).toBe(0);
    expect(routeSimilarity(commute, []).score).toBe(0);
  });
});
