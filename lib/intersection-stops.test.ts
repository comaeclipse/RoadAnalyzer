import { describe, it, expect } from 'vitest';
import {
  analyzeIntersections,
  bearingDegrees,
  bearingDelta,
  cardinal,
  circularMeanBearing,
  countPasses,
  detectStops,
  effectiveSpeed,
  haversineMeters,
  resolveOptions,
  wilsonInterval,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
  type AnalysisPoint,
} from './intersection-stops';

// ~111.32 m per 0.001 degree of latitude
const METRE_LAT = 0.001 / 111.32;

/** Straight run of samples heading due north through `stopAt`, if given. */
function northboundDrive(
  id: string,
  startLat: number,
  lng: number,
  count: number,
  stopRange?: [number, number]
): AnalysisDrive {
  const points: AnalysisPoint[] = [];
  for (let i = 0; i < count; i++) {
    const stopped = stopRange && i >= stopRange[0] && i <= stopRange[1];
    points.push({
      lat: startLat + i * 10 * METRE_LAT, // 10 m per sample
      lng,
      speed: stopped ? 0 : 12,
      timestamp: 1_000_000 + i * 1_000,
      roadName: 'Test Road',
    });
  }
  // While stopped the vehicle does not move; collapse those positions.
  if (stopRange) {
    const held = points[stopRange[0]].lat;
    for (let i = stopRange[0]; i <= stopRange[1]; i++) points[i].lat = held;
    for (let i = stopRange[1] + 1; i < count; i++) {
      points[i].lat = held + (i - stopRange[1]) * 10 * METRE_LAT;
    }
  }
  return { id, name: id, startTime: '2026-08-01T12:00:00.000Z', points };
}

/** Point `metres` from `from` along `bearing`, for building synthetic approaches. */
function offsetBy(
  from: { lat: number; lng: number },
  metres: number,
  bearing: number
): { lat: number; lng: number } {
  const radians = (bearing * Math.PI) / 180;
  return {
    lat: from.lat + (metres * Math.cos(radians)) / 111_320,
    lng:
      from.lng +
      (metres * Math.sin(radians)) / (111_320 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

/**
 * A drive running straight through `target` on the given heading, stopping
 * there long enough to register. Used to give one place several approaches
 * that differ only in direction.
 */
function approachingDrive(
  id: string,
  target: { lat: number; lng: number },
  bearing: number,
  count = 60,
  stopRange: [number, number] = [30, 40]
): AnalysisDrive {
  const [stopStart, stopEnd] = stopRange;
  const points: AnalysisPoint[] = [];
  for (let i = 0; i < count; i++) {
    const metres =
      i < stopStart ? -(stopStart - i) * 10 : i > stopEnd ? (i - stopEnd) * 10 : 0;
    points.push({
      ...offsetBy(target, metres, bearing),
      speed: i >= stopStart && i <= stopEnd ? 0 : 12,
      timestamp: 1_000_000 + i * 1_000,
      roadName: 'Test Road',
    });
  }
  return { id, name: id, startTime: '2026-08-01T12:00:00.000Z', points };
}

describe('geometry', () => {
  it('measures distance between known points', () => {
    const a = { lat: 30.4, lng: -87.2 };
    const b = { lat: 30.401, lng: -87.2 };
    expect(haversineMeters(a, b)).toBeGreaterThan(110);
    expect(haversineMeters(a, b)).toBeLessThan(112);
  });

  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 30, lng: -87 }, { lat: 30, lng: -87 })).toBe(0);
  });

  it('computes cardinal bearings', () => {
    // Sample-scale offsets. Over a long east-west span the *initial* great-circle
    // bearing is legitimately not 90 degrees, so keep the deltas realistic.
    expect(bearingDegrees({ lat: 30, lng: -87 }, { lat: 30.001, lng: -87 })).toBeCloseTo(0, 1);
    expect(bearingDegrees({ lat: 30, lng: -87 }, { lat: 30, lng: -86.999 })).toBeCloseTo(90, 1);
    expect(bearingDegrees({ lat: 30, lng: -87 }, { lat: 29.999, lng: -87 })).toBeCloseTo(180, 1);
    expect(bearingDegrees({ lat: 30, lng: -87 }, { lat: 30, lng: -87.001 })).toBeCloseTo(270, 1);
  });

  it('treats bearing difference as circular', () => {
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(20);
    expect(bearingDelta(0, 180)).toBe(180);
    expect(bearingDelta(90, 90)).toBe(0);
  });

  it('labels compass directions, wrapping at north', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(90)).toBe('E');
    expect(cardinal(181)).toBe('S');
    expect(cardinal(359)).toBe('N');
  });
});

describe('wilsonInterval', () => {
  it('does not claim certainty from a small perfect record', () => {
    const { low, high } = wilsonInterval(2, 2);
    expect(low).toBeLessThan(0.7);
    expect(high).toBeCloseTo(1, 5);
  });

  it('narrows as evidence accumulates', () => {
    const few = wilsonInterval(10, 20);
    const many = wilsonInterval(100, 200);
    expect(many.high - many.low).toBeLessThan(few.high - few.low);
  });

  it('spans the whole range with no trials', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('brackets the observed proportion', () => {
    const { low, high } = wilsonInterval(3, 10);
    expect(low).toBeLessThan(0.3);
    expect(high).toBeGreaterThan(0.3);
  });
});

describe('detectStops', () => {
  it('finds a stop that lasts long enough', () => {
    const stops = detectStops(northboundDrive('d1', 30.4, -87.2, 40, [20, 30]));
    expect(stops).toHaveLength(1);
    expect(stops[0].duration).toBe(10_000);
    expect(stops[0].bearing).toBeCloseTo(0, 0);
  });

  it('ignores a pause below the duration threshold', () => {
    const stops = detectStops(northboundDrive('d1', 30.4, -87.2, 40, [20, 22]));
    expect(stops).toHaveLength(0);
  });

  it('finds nothing on a drive that never stops', () => {
    expect(detectStops(northboundDrive('d1', 30.4, -87.2, 40))).toHaveLength(0);
  });

  it('handles a stop running to the end of the trace', () => {
    const stops = detectStops(northboundDrive('d1', 30.4, -87.2, 40, [25, 39]));
    expect(stops).toHaveLength(1);
  });

  // A dropout at speed used to read as stationary, inventing a stop wherever
  // reception dipped. Positions keep moving through the gap and settle it.
  it('does not invent a stop when speed drops out at highway pace', () => {
    const points: AnalysisPoint[] = [];
    for (let i = 0; i < 60; i++) {
      points.push({
        lat: 30.4 + i * 30 * METRE_LAT, // 30 m/s, ~67 mph
        lng: -87.2,
        speed: i >= 30 && i <= 40 ? null : 30,
        timestamp: 1_000_000 + i * 1_000,
      });
    }
    expect(detectStops({ id: 'x', name: 'x', startTime: '', points })).toHaveLength(0);
  });

  it('rejects the -1 CoreLocation reports for an invalid speed', () => {
    const points: AnalysisPoint[] = [];
    for (let i = 0; i < 60; i++) {
      points.push({
        lat: 30.4 + i * 30 * METRE_LAT,
        lng: -87.2,
        speed: i >= 30 && i <= 40 ? -1 : 30,
        timestamp: 1_000_000 + i * 1_000,
      });
    }
    expect(detectStops({ id: 'x', name: 'x', startTime: '', points })).toHaveLength(0);
  });

  it('still finds a real stop when speed is missing but positions are static', () => {
    const points: AnalysisPoint[] = [];
    for (let i = 0; i < 60; i++) {
      const stopped = i >= 20 && i <= 40;
      points.push({
        lat: 30.4 + Math.min(i, 20) * 10 * METRE_LAT,
        lng: -87.2,
        speed: stopped ? null : 12,
        timestamp: 1_000_000 + i * 1_000,
      });
    }
    const stops = detectStops({ id: 'x', name: 'x', startTime: '', points });
    expect(stops).toHaveLength(1);
    expect(stops[0].duration).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.minStopDuration);
  });
});

describe('countPasses', () => {
  it('counts a traversal in the matching direction', () => {
    const drive = northboundDrive('d1', 30.4, -87.2, 60);
    const midpoint = drive.points[30];
    expect(countPasses(drive, { ...midpoint, bearing: 0 })).toBe(1);
  });

  it('does not count a traversal in the opposite direction', () => {
    const drive = northboundDrive('d1', 30.4, -87.2, 60);
    const midpoint = drive.points[30];
    expect(countPasses(drive, { ...midpoint, bearing: 180 })).toBe(0);
  });

  it('does not count a drive that never comes near', () => {
    const drive = northboundDrive('d1', 30.4, -87.2, 60);
    expect(countPasses(drive, { lat: 30.9, lng: -87.2, bearing: 0 })).toBe(0);
  });

  it('counts one visit per traversal, not one per sample', () => {
    // 45 m pass radius over 10 m spacing means several samples fall inside.
    const drive = northboundDrive('d1', 30.4, -87.2, 60);
    expect(countPasses(drive, { ...drive.points[30], bearing: 0 })).toBe(1);
  });

  // The band between passRadius and clusterRadius used to admit stops to the
  // numerator while rejecting the same ground from the denominator.
  it('counts a traversal out to the cluster radius, not just the pass radius', () => {
    const offsetMetres = 50; // outside the raw 45 m, inside the 60 m cluster
    const lngOffset = offsetMetres / (111_320 * Math.cos((30.4 * Math.PI) / 180));
    const drive = northboundDrive('d1', 30.4 - 200 * METRE_LAT, -87.2 + lngOffset, 60);
    expect(countPasses(drive, { lat: 30.4, lng: -87.2, bearing: 0 })).toBe(1);
  });
});

describe('circularMeanBearing', () => {
  it('averages without wrapping the wrong way round north', () => {
    // The arithmetic mean of these is 180, pointing due south.
    expect(circularMeanBearing([350, 10])).toBeCloseTo(0, 5);
  });

  it('averages a plain spread', () => {
    expect(circularMeanBearing([80, 90, 100])).toBeCloseTo(90, 5);
  });

  it('returns the sole bearing unchanged', () => {
    expect(circularMeanBearing([237])).toBeCloseTo(237, 5);
  });

  it('reports no central direction when the vectors cancel', () => {
    expect(circularMeanBearing([0, 180])).toBeNull();
  });

  it('has nothing to average over an empty set', () => {
    expect(circularMeanBearing([])).toBeNull();
  });

  it('stays inside [0, 360)', () => {
    const mean = circularMeanBearing([350, 340, 5]);
    expect(mean).not.toBeNull();
    expect(mean!).toBeGreaterThanOrEqual(0);
    expect(mean!).toBeLessThan(360);
  });
});

describe('effectiveSpeed', () => {
  const at = (lat: number, seconds: number, speed: number | null): AnalysisPoint => ({
    lat,
    lng: -87.2,
    speed,
    timestamp: 1_000_000 + seconds * 1_000,
  });

  it('trusts a reported speed', () => {
    expect(effectiveSpeed(at(30.4, 1, 12), at(30.4, 0, 12))).toBe(12);
  });

  it('derives speed from movement when the reading is missing', () => {
    const previous = at(30.4, 0, null);
    const point = at(30.4 + 30 * METRE_LAT, 1, null);
    expect(effectiveSpeed(point, previous)).toBeCloseTo(30, 0);
  });

  it('treats a static pair with no reading as stationary', () => {
    expect(effectiveSpeed(at(30.4, 1, null), at(30.4, 0, null))).toBeCloseTo(0, 5);
  });

  it('gives up rather than guessing without a previous sample', () => {
    expect(effectiveSpeed(at(30.4, 0, null), null)).toBeNull();
  });

  it('gives up across a gap too long to describe the motion', () => {
    expect(effectiveSpeed(at(30.4, 30, null), at(30.4, 0, null))).toBeNull();
  });
});

describe('resolveOptions', () => {
  it('widens the pass radius to contain the cluster radius', () => {
    const resolved = resolveOptions({ ...DEFAULT_OPTIONS, clusterRadius: 60, passRadius: 45 });
    expect(resolved.passRadius).toBe(60);
  });

  it('leaves an already-containing pass radius alone', () => {
    const options = { ...DEFAULT_OPTIONS, clusterRadius: 40, passRadius: 45 };
    expect(resolveOptions(options).passRadius).toBe(45);
  });

  it('holds for the shipped defaults', () => {
    expect(resolveOptions(DEFAULT_OPTIONS).passRadius)
      .toBeGreaterThanOrEqual(DEFAULT_OPTIONS.clusterRadius);
  });
});

describe('analyzeIntersections', () => {
  it('separates opposite approaches to the same place', () => {
    const northbound = northboundDrive('north', 30.4, -87.2, 60, [30, 40]);
    // Same coordinates travelled the other way.
    const southbound: AnalysisDrive = {
      id: 'south',
      name: 'south',
      startTime: '2026-08-02T12:00:00.000Z',
      points: [...northbound.points]
        .reverse()
        .map((point, index) => ({ ...point, speed: 12, timestamp: 1_000_000 + index * 1_000 })),
    };
    // Give the southbound drive its own stop.
    for (let i = 30; i <= 40; i++) southbound.points[i].speed = 0;

    const approaches = analyzeIntersections([northbound, southbound]);
    expect(approaches).toHaveLength(2);
    const bearings = approaches.map((a) => Math.round(a.bearing));
    expect(bearingDelta(bearings[0], bearings[1])).toBeGreaterThan(150);
  });

  it('reports a denominator that includes drives which did not stop', () => {
    const stopper = northboundDrive('stopper', 30.4, -87.2, 60, [30, 40]);
    const roller = northboundDrive('roller', 30.4, -87.2, 60);
    const [approach] = analyzeIntersections([stopper, roller]);
    expect(approach.stopCount).toBe(1);
    expect(approach.passes).toBe(2);
    expect(approach.probability).toBeCloseTo(0.5, 5);
  });

  it('groups repeat stops at one place into a single approach', () => {
    const first = northboundDrive('first', 30.4, -87.2, 60, [30, 40]);
    const second = northboundDrive('second', 30.4, -87.2, 60, [30, 45]);
    const approaches = analyzeIntersections([first, second]);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].stopCount).toBe(2);
    expect(approaches[0].probability).toBe(1);
    // Two-for-two is not evidence of certainty.
    expect(approaches[0].confidenceLow).toBeLessThan(0.7);
  });

  it('keeps queue-creep stops within 60 m at the same approach', () => {
    const first = northboundDrive('first', 30.4, -87.2, 80, [30, 40]);
    const second = northboundDrive('second', 30.4 + 50 * METRE_LAT, -87.2, 80, [30, 40]);
    const approaches = analyzeIntersections([first, second]);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].stopCount).toBe(2);
  });

  // The cluster heading used to be frozen at whichever stop seeded the group,
  // so one skewed approach steered the accepted cone and the reported
  // direction for every stop that followed.
  it('takes its heading from the whole group, not the stop that seeded it', () => {
    const target = { lat: 30.4, lng: -87.2 };
    const drives = [
      approachingDrive('skewed', target, 40),
      approachingDrive('straight-1', target, 0),
      approachingDrive('straight-2', target, 0),
      approachingDrive('straight-3', target, 0),
    ];
    const approaches = analyzeIntersections(drives);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].stopCount).toBe(4);
    // Seeded at ~40 deg, but three of four approaches ran due north.
    expect(approaches[0].bearing).toBeLessThan(20);
    expect(approaches[0].direction).toBe('northbound');
  });

  it('does not let a skewed seed change which stops join the cluster', () => {
    const target = { lat: 30.4, lng: -87.2 };
    const seedFirst = analyzeIntersections([
      approachingDrive('skewed', target, 45),
      approachingDrive('a', target, 0),
      approachingDrive('b', target, 0),
    ]);
    const seedLast = analyzeIntersections([
      approachingDrive('a', target, 0),
      approachingDrive('b', target, 0),
      approachingDrive('skewed', target, 45),
    ]);
    expect(seedFirst).toHaveLength(1);
    expect(seedLast).toHaveLength(1);
    expect(seedFirst[0].stopCount).toBe(seedLast[0].stopCount);
    expect(seedFirst[0].bearing).toBeCloseTo(seedLast[0].bearing, 5);
  });

  it('never reports more stops than passes', () => {
    const drives = [
      northboundDrive('a', 30.4, -87.2, 60, [30, 40]),
      northboundDrive('b', 30.4, -87.2, 60, [30, 40]),
      northboundDrive('c', 30.4, -87.2, 60),
    ];
    for (const approach of analyzeIntersections(drives)) {
      expect(approach.stopCount).toBeLessThanOrEqual(approach.passes);
      expect(approach.probability).toBeLessThanOrEqual(1);
    }
  });

  // The assertion above is satisfied by the clamp alone, so it cannot catch a
  // denominator that was never measured. This one checks the clamp stayed out
  // of it, including across the queue spread that motivated the 60 m cluster.
  it('measures the denominator directly rather than leaning on the clamp', () => {
    const drives = [
      northboundDrive('a', 30.4, -87.2, 80, [30, 40]),
      northboundDrive('b', 30.4 + 50 * METRE_LAT, -87.2, 80, [30, 40]),
      northboundDrive('c', 30.4 + 25 * METRE_LAT, -87.2, 80, [30, 40]),
      northboundDrive('d', 30.4, -87.2, 80),
    ];
    const approaches = analyzeIntersections(drives);
    expect(approaches.length).toBeGreaterThan(0);
    for (const approach of approaches) {
      expect(approach.passesClamped).toBe(false);
    }
  });

  it('counts a non-stopping traversal spread across the queue as a pass', () => {
    // Stops 50 m apart cluster together; the centroid sits between them. A
    // drive that rolled through must still land in the denominator.
    const early = northboundDrive('early', 30.4, -87.2, 80, [30, 40]);
    const late = northboundDrive('late', 30.4 + 50 * METRE_LAT, -87.2, 80, [30, 40]);
    const roller = northboundDrive('roller', 30.4, -87.2, 80);
    const approaches = analyzeIntersections([early, late, roller]);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].stopCount).toBe(2);
    expect(approaches[0].passes).toBe(3);
    expect(approaches[0].probability).toBeCloseTo(2 / 3, 5);
  });

  it('returns nothing when no drive ever stops', () => {
    expect(analyzeIntersections([northboundDrive('a', 30.4, -87.2, 60)])).toEqual([]);
  });

  it('labels the stop kind from a nearby tag', () => {
    const drive = northboundDrive('a', 30.4, -87.2, 60, [30, 40]);
    drive.tags = [{ lat: drive.points[30].lat, lng: drive.points[30].lng, kind: 'RED_LIGHT' }];
    expect(analyzeIntersections([drive])[0].kind).toBe('RED_LIGHT');
  });

  it('falls back to UNCLASSIFIED without a tag', () => {
    expect(analyzeIntersections([northboundDrive('a', 30.4, -87.2, 60, [30, 40])])[0].kind)
      .toBe('UNCLASSIFIED');
  });

  it('ranks by total time lost', () => {
    const long = northboundDrive('long', 30.4, -87.2, 60, [30, 55]);
    const short = northboundDrive('short', 30.5, -87.2, 60, [30, 36]);
    const approaches = analyzeIntersections([long, short]);
    expect(approaches[0].totalDelay).toBeGreaterThanOrEqual(approaches[1].totalDelay);
  });

  it('respects a custom stopped-speed threshold', () => {
    const drive = northboundDrive('a', 30.4, -87.2, 60);
    for (let i = 30; i <= 40; i++) drive.points[i].speed = 1.5;
    expect(detectStops(drive, DEFAULT_OPTIONS)).toHaveLength(0);
    expect(detectStops(drive, { ...DEFAULT_OPTIONS, stoppedSpeed: 2 })).toHaveLength(1);
  });
});
