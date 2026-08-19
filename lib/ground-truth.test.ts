import { describe, expect, it } from 'vitest';
import { generateCorpus, generateScenario, MEASURED_NOISE } from './ground-truth';

const base = {
  seed: 1,
  redSeconds: 45,
  greenSeconds: 40,
  queueAhead: 0,
  cruiseSpeed: 13,
};

describe('the generator itself', () => {
  // Before trusting anything the harness reports, the generator has to agree
  // with arithmetic on cases where the answer is obvious.

  it('gives a vehicle arriving on green with no queue no delay at all', () => {
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 50 });
    expect(truth.stoppedSeconds).toBe(0);
    expect(truth.controlDelaySeconds).toBe(0);
    expect(truth.arrivedOnRed).toBe(false);
  });

  it('makes a vehicle arriving at the start of red wait the whole red', () => {
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    expect(truth.stoppedSeconds).toBe(45);
    expect(truth.arrivedOnRed).toBe(true);
  });

  it('makes a vehicle arriving late in red wait only the remainder', () => {
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 30 });
    expect(truth.stoppedSeconds).toBe(15);
  });

  it('adds a headway per queued vehicle ahead', () => {
    // Startup lost time plus seven vehicles at the saturation headway.
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 0, queueAhead: 7 });
    expect(truth.stoppedSeconds).toBe(45 + 2 + 14);
  });

  it('charges control delay above the stopped time for braking and launching', () => {
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    expect(truth.controlDelaySeconds).toBeGreaterThan(truth.stoppedSeconds);
    // Half the braking time plus half the launch time, at these rates.
    expect(truth.controlDelaySeconds - truth.stoppedSeconds).toBeCloseTo(13 / 2 / 2.5 + 13 / 2 / 1.8, 5);
  });

  it('flags a vehicle stopped on green by the queue alone', () => {
    // Green begins at 45 s; a queue of 8 is still discharging at 63 s.
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 50, queueAhead: 8 });
    expect(truth.arrivedOnRed).toBe(false);
    expect(truth.stoppedSeconds).toBeGreaterThan(0);
    expect(truth.stoppedByQueueOnly).toBe(true);
  });

  it('does not flag the queue confound when the queue has already cleared', () => {
    const { truth } = generateScenario({ ...base, arrivalOffsetSeconds: 80, queueAhead: 3 });
    expect(truth.stoppedSeconds).toBe(0);
    expect(truth.stoppedByQueueOnly).toBe(false);
  });
});

describe('the traces it produces', () => {
  it('samples at the rate the recorder actually uses', () => {
    const { drive } = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    const gaps = drive.points.slice(1).map((point, index) => point.timestamp - drive.points[index].timestamp);
    expect(new Set(gaps)).toEqual(new Set([MEASURED_NOISE.intervalMs]));
  });

  it('holds position while stopped, within the receiver-s scatter', () => {
    const { drive } = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    const stationary = drive.points.filter((point) => (point.speed ?? 1) < 0.5);
    const lats = stationary.map((point) => point.lat);
    const spreadMeters = (Math.max(...lats) - Math.min(...lats)) * 111_320;
    expect(stationary.length).toBeGreaterThan(30);
    // Scattered, not pinned: a trace that held one exact position would pass
    // tests real data fails.
    expect(spreadMeters).toBeGreaterThan(1);
    expect(spreadMeters).toBeLessThan(30);
  });

  it('reports a small non-zero speed at rest, as the sensor does', () => {
    const { drive } = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    const atRest = drive.points.filter((point) => (point.speed ?? 1) < 0.5).map((point) => point.speed!);
    expect(atRest.some((speed) => speed > 0)).toBe(true);
    expect(Math.max(...atRest)).toBeLessThanOrEqual(MEASURED_NOISE.restSpeedP90);
  });

  it('drops speed at the rate asked for, and not otherwise', () => {
    const clean = generateScenario({ ...base, arrivalOffsetSeconds: 0 });
    expect(clean.drive.points.every((point) => point.speed !== null)).toBe(true);

    const lossy = generateScenario({ ...base, arrivalOffsetSeconds: 0, missingSpeedRate: 0.25 });
    const missing = lossy.drive.points.filter((point) => point.speed === null).length;
    expect(missing / lossy.drive.points.length).toBeGreaterThan(0.1);
  });

  it('is reproducible from its seed', () => {
    const first = generateScenario({ ...base, arrivalOffsetSeconds: 20 });
    const second = generateScenario({ ...base, arrivalOffsetSeconds: 20 });
    expect(second.drive.points).toEqual(first.drive.points);
  });

  it('builds a corpus that actually spans the matrix', () => {
    const corpus = generateCorpus(200);
    expect(corpus).toHaveLength(200);
    expect(corpus.filter((s) => s.truth.arrivedOnRed).length).toBeGreaterThan(40);
    expect(corpus.filter((s) => !s.truth.arrivedOnRed).length).toBeGreaterThan(40);
    expect(corpus.filter((s) => s.truth.stoppedSeconds === 0).length).toBeGreaterThan(10);
    expect(corpus.filter((s) => s.truth.stoppedByQueueOnly).length).toBeGreaterThan(5);
    expect(corpus.filter((s) => s.truth.queueAhead > 0).length).toBeGreaterThan(80);
  });
});
