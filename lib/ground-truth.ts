/**
 * Labelled approaches to a signalised intersection, for measuring how accurate
 * the delay estimates actually are.
 *
 * lib/intersection-stops.test.ts pins behaviour — clustering, bearing
 * tolerance, the numerator/denominator invariant — but every number it asserts
 * is one we chose while writing the fixture. Nothing in the suite says "the
 * true delay was 39 s" and checks whether we reported 37 s. This generates
 * traces whose truth is known by construction, so that question can be asked.
 *
 * ## Why this and not SUMO
 *
 * The plan called for Eclipse SUMO. SUMO simulates each vehicle against a
 * modelled network, which buys realistic car-following and queue discharge, and
 * it would be the right tool for questions about *traffic*. The questions here
 * are about our estimator: given a vehicle that truly stopped for 39 s, do we
 * say 39 s? For that, truth computed analytically is better than truth measured
 * out of a simulation — it is exact, it needs no install, and it keeps the
 * corpus reproducible from a seed rather than from a multi-megabyte checked-in
 * blob. The queue model below is the standard startup-lost-time and saturation-
 * headway formulation that a microsimulator approximates anyway.
 *
 * What that costs: no shockwave propagation, no heterogeneous drivers, no
 * lane changes. If a question ever turns on those, generateFromSumo belongs
 * beside generateScenario, writing the same Scenario shape.
 *
 * ## Test infrastructure
 *
 * Nothing in app/ imports this. It is pure, dependency-free, and deterministic
 * given a seed.
 */

import {
  analyzeIntersections,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
  type AnalysisOptions,
  type AnalysisPoint,
} from './intersection-stops';

/**
 * Sampling and error characteristics measured from ten real recorded drives by
 * scripts/ground-truth/measure-noise.ts. A trace that is cleaner than this
 * passes tests that real data would fail.
 *
 *   sample interval : 1000 ms, p05 through p95 (the recorder is very regular)
 *   accuracy        : median 2.3 m, p90 7.9 m, max 26.5 m
 *   missing speed   : 0 of 9701 samples
 *   speed at rest   : median 0.000, p90 0.094, max 0.982 m/s
 */
export const MEASURED_NOISE = {
  intervalMs: 1_000,
  accuracyMedianMeters: 2.3,
  accuracyP90Meters: 7.9,
  /**
   * Zero on this recorder. Kept configurable because the code has a whole path
   * for missing speed, and a harness that cannot exercise it cannot catch a
   * regression in it.
   */
  missingSpeedRate: 0,
  /** Speed the sensor reports for a stationary vehicle. */
  restSpeedP90: 0.094,
} as const;

export interface ScenarioOptions {
  /** Distinguishes drives, and seeds this scenario's noise. */
  seed: number;
  /** Seconds of red in the cycle. */
  redSeconds: number;
  /** Seconds of green in the cycle. */
  greenSeconds: number;
  /**
   * Seconds into the cycle at which the vehicle reaches the stop line, had it
   * never slowed. 0 is the instant red begins.
   */
  arrivalOffsetSeconds: number;
  /** Vehicles already queued ahead when the cycle turns green. */
  queueAhead: number;
  /** Free-flow approach speed, m/s. */
  cruiseSpeed: number;
  /** Fraction of samples whose speed is missing. Defaults to the measured rate. */
  missingSpeedRate?: number;
  /** Multiplier on positional noise, for testing degraded reception. */
  noiseScale?: number;
  /** Epoch milliseconds at which the drive starts. */
  startedAt?: number;
}

export interface Scenario {
  drive: AnalysisDrive;
  truth: {
    /**
     * Seconds the vehicle was genuinely stationary. This is what detectStops
     * measures, so it is what the estimate is scored against.
     */
    stoppedSeconds: number;
    /**
     * Seconds lost against an uninterrupted run at cruise speed — the
     * traffic-engineering definition of control delay. Always larger than the
     * stopped time, because deceleration and acceleration cost time in which
     * the vehicle was still moving.
     */
    controlDelaySeconds: number;
    /** Whether the vehicle reached the stop line during red. */
    arrivedOnRed: boolean;
    /**
     * True when the vehicle stopped despite arriving on green, held up only by
     * the queue still discharging ahead of it. The confound the whole approach
     * rests on: the stop is real, the signal did not cause it.
     */
    stoppedByQueueOnly: boolean;
    queueAhead: number;
  };
}

/** Deterministic PRNG, so a seed reproduces a corpus exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, for noise that looks like measurement error rather than a slab. */
function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

// A northbound approach near Pensacola. The road is straight, so approach
// bearing is unambiguous and clustering behaviour is not what is under test.
const STOP_LINE = { lat: 30.4400, lng: -87.2600 };
const METERS_PER_DEGREE_LAT = 111_320;
const APPROACH_METERS = 400;
const DEPARTURE_METERS = 250;

/** Vehicles do not all launch at once when the light turns green. */
const STARTUP_LOST_SECONDS = 2;
const SATURATION_HEADWAY_SECONDS = 2;
const DECELERATION = 2.5; // m/s^2, comfortable braking
const ACCELERATION = 1.8; // m/s^2, unhurried launch

/**
 * One labelled approach.
 *
 * The vehicle cruises, brakes to a stop at the line if it must, waits for its
 * turn to depart, and accelerates away. Truth falls out of the construction:
 * the stopped time is the wait, and the control delay is the whole journey
 * measured against an uninterrupted run at cruise speed.
 */
export function generateScenario(options: ScenarioOptions): Scenario {
  const random = mulberry32(options.seed);
  const {
    redSeconds, greenSeconds, arrivalOffsetSeconds, queueAhead, cruiseSpeed,
  } = options;
  const cycle = redSeconds + greenSeconds;
  const arrival = ((arrivalOffsetSeconds % cycle) + cycle) % cycle;
  const arrivedOnRed = arrival < redSeconds;

  // When this vehicle may cross. During red, everyone waits for green, then
  // the queue discharges one vehicle per headway after the startup loss.
  const queueClearsAt = queueAhead > 0
    ? redSeconds + STARTUP_LOST_SECONDS + queueAhead * SATURATION_HEADWAY_SECONDS
    : redSeconds;
  const earliestCrossing = arrivedOnRed ? Math.max(redSeconds, queueClearsAt) : Math.max(arrival, queueClearsAt);
  const mustStop = earliestCrossing > arrival + 1e-9;
  const stoppedSeconds = mustStop ? earliestCrossing - arrival : 0;
  const stoppedByQueueOnly = mustStop && !arrivedOnRed;

  // Braking and launching both cost time on top of the wait: the vehicle is
  // moving, but slower than it would have been.
  const brakingDistance = (cruiseSpeed * cruiseSpeed) / (2 * DECELERATION);
  const launchDistance = (cruiseSpeed * cruiseSpeed) / (2 * ACCELERATION);
  const brakingTime = cruiseSpeed / DECELERATION;
  const launchTime = cruiseSpeed / ACCELERATION;
  const manoeuvreLoss = mustStop
    ? (brakingTime - brakingDistance / cruiseSpeed) + (launchTime - launchDistance / cruiseSpeed)
    : 0;
  const controlDelaySeconds = stoppedSeconds + manoeuvreLoss;

  const points = buildTrace({
    random,
    cruiseSpeed,
    mustStop,
    stoppedSeconds,
    brakingDistance,
    launchDistance,
    missingSpeedRate: options.missingSpeedRate ?? MEASURED_NOISE.missingSpeedRate,
    noiseScale: options.noiseScale ?? 1,
    startedAt: options.startedAt ?? 1_780_000_000_000,
  });

  return {
    drive: {
      id: `scenario-${options.seed}`,
      name: `scenario-${options.seed}`,
      startTime: new Date(points[0].timestamp).toISOString(),
      points,
    },
    truth: {
      stoppedSeconds,
      controlDelaySeconds,
      arrivedOnRed,
      stoppedByQueueOnly,
      queueAhead,
    },
  };
}

/**
 * Sample the vehicle's motion at the recorder's rate, then degrade it the way a
 * phone does: position scattered by the accuracy the receiver actually
 * achieves, speed occasionally missing, and a stationary vehicle reporting a
 * small non-zero speed rather than a clean zero.
 */
function buildTrace(config: {
  random: () => number;
  cruiseSpeed: number;
  mustStop: boolean;
  stoppedSeconds: number;
  brakingDistance: number;
  launchDistance: number;
  missingSpeedRate: number;
  noiseScale: number;
  startedAt: number;
}): AnalysisPoint[] {
  const {
    random, cruiseSpeed, mustStop, stoppedSeconds, brakingDistance, launchDistance,
    missingSpeedRate, noiseScale, startedAt,
  } = config;

  // Distance from the start of the trace, and the speed there, as a function of
  // elapsed time. Phases: cruise, brake, wait, launch, cruise.
  const cruiseToBrake = (APPROACH_METERS - (mustStop ? brakingDistance : 0)) / cruiseSpeed;
  const brakeTime = mustStop ? cruiseSpeed / DECELERATION : 0;
  const launchTime = mustStop ? cruiseSpeed / ACCELERATION : 0;
  const total = cruiseToBrake + brakeTime + stoppedSeconds + launchTime +
    (DEPARTURE_METERS - (mustStop ? launchDistance : 0)) / cruiseSpeed;

  const points: AnalysisPoint[] = [];
  for (let elapsed = 0; elapsed <= total; elapsed += MEASURED_NOISE.intervalMs / 1000) {
    let distance: number;
    let speed: number;

    if (elapsed <= cruiseToBrake) {
      distance = cruiseSpeed * elapsed;
      speed = cruiseSpeed;
    } else if (elapsed <= cruiseToBrake + brakeTime) {
      const t = elapsed - cruiseToBrake;
      distance = cruiseSpeed * cruiseToBrake + cruiseSpeed * t - 0.5 * DECELERATION * t * t;
      speed = Math.max(0, cruiseSpeed - DECELERATION * t);
    } else if (elapsed <= cruiseToBrake + brakeTime + stoppedSeconds) {
      distance = APPROACH_METERS;
      speed = 0;
    } else if (elapsed <= cruiseToBrake + brakeTime + stoppedSeconds + launchTime) {
      const t = elapsed - cruiseToBrake - brakeTime - stoppedSeconds;
      distance = APPROACH_METERS + 0.5 * ACCELERATION * t * t;
      speed = Math.min(cruiseSpeed, ACCELERATION * t);
    } else {
      const t = elapsed - cruiseToBrake - brakeTime - stoppedSeconds - launchTime;
      distance = APPROACH_METERS + launchDistance + cruiseSpeed * t;
      speed = cruiseSpeed;
    }

    // Scatter the fix. Accuracy is lognormal-ish in the real data; a gaussian
    // scaled to the measured median with occasional larger excursions is close
    // enough for a corpus whose purpose is to be imperfect.
    const scatter = MEASURED_NOISE.accuracyMedianMeters * noiseScale;
    const northMeters = distance - APPROACH_METERS + gaussian(random) * scatter;
    const eastMeters = gaussian(random) * scatter;

    const reportedSpeed = random() < missingSpeedRate
      ? null
      : speed === 0
        ? random() * MEASURED_NOISE.restSpeedP90
        : Math.max(0, speed + gaussian(random) * 0.3);

    points.push({
      lat: STOP_LINE.lat + northMeters / METERS_PER_DEGREE_LAT,
      lng: STOP_LINE.lng + eastMeters / (METERS_PER_DEGREE_LAT * Math.cos(STOP_LINE.lat * Math.PI / 180)),
      speed: reportedSpeed,
      timestamp: startedAt + Math.round(elapsed * 1000),
      roadName: 'Test Arterial',
    });
  }

  return points;
}

/**
 * A corpus spanning the scenario matrix: arrival phase against queue length,
 * with speed and cycle varied so nothing can pass by memorising one geometry.
 *
 * Deterministic in `count`, so a baseline recorded against it stays comparable.
 */
export function generateCorpus(count: number, overrides: Partial<ScenarioOptions> = {}): Scenario[] {
  const scenarios: Scenario[] = [];
  for (let index = 0; index < count; index++) {
    const random = mulberry32(0x5eed + index);
    const redSeconds = 25 + Math.floor(random() * 60);
    const greenSeconds = 20 + Math.floor(random() * 40);
    scenarios.push(generateScenario({
      seed: index + 1,
      redSeconds,
      greenSeconds,
      arrivalOffsetSeconds: random() * (redSeconds + greenSeconds),
      queueAhead: Math.floor(random() * 9),
      cruiseSpeed: 9 + random() * 9,
      // Each drive starts far enough after the last that nothing merges.
      startedAt: 1_780_000_000_000 + index * 3_600_000,
      ...overrides,
    }));
  }
  return scenarios;
}

/** How close the estimates came, over a corpus whose answers are known. */
export interface AccuracyReport {
  scenarios: number;
  /** Scenarios whose true stop was long enough that we expect to see it. */
  detectable: number;
  /** Of those, how many produced a detected stop. */
  detected: number;
  /** A stop reported where the vehicle never stopped. */
  falsePositives: number;
  /** Seconds, over the detected scenarios. */
  medianAbsError: number;
  p90AbsError: number;
  maxAbsError: number;
  /** Mean signed error: positive means we over-report the wait. */
  bias: number;
  /**
   * The same figures against control delay rather than stopped time. Reported
   * because the page calls the number "delay" while the estimator measures
   * stopped time, and the gap between the two is a property worth stating.
   */
  medianAbsErrorVsControlDelay: number;
  byClass: Record<string, { scenarios: number; detected: number; medianAbsError: number }>;
  /**
   * How much of what we call intersection delay was not caused by the signal.
   *
   * A vehicle arriving on green behind a queue that has not finished
   * discharging stops just as surely as one arriving on red, at the same place,
   * for a comparable time. Nothing in the trace distinguishes the two, so every
   * one of these is counted as a stop at the intersection.
   *
   * The fraction is a property of the traffic, not of the code, so it says what
   * the confound costs *for this scenario mix* rather than on any real commute.
   * What is not mix-dependent is that the pipeline classifies all of them
   * identically.
   */
  confound: {
    detectedStops: number;
    causedByQueueAlone: number;
    fraction: number;
    medianQueueOnlyDelay: number;
    medianSignalDelay: number;
    /**
     * Share of total measured delay, as opposed to share of stop count. These
     * diverge sharply, and the difference is the practical answer: a queue stop
     * is short, so it inflates how often an approach appears to stop you far
     * more than it inflates how long it holds you.
     */
    shareOfDelay: number;
  };
}

const median = (values: number[]): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantile = (values: number[], fraction: number): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

/**
 * Run the real analysis over a labelled corpus and report how far off it was.
 *
 * Deliberately a distribution rather than a pass or fail. A binary assertion on
 * a statistical estimator is either loose enough to catch nothing or tight
 * enough to flake; a median and a p90 tracked against a committed baseline say
 * something either way.
 */
export function measureDelayAccuracy(
  scenarios: Scenario[],
  options: AnalysisOptions = DEFAULT_OPTIONS
): AccuracyReport {
  const approaches = analyzeIntersections(scenarios.map((scenario) => scenario.drive), options);

  // A drive may contribute several stops if its trace fragmented; what it cost
  // the driver is the total.
  const detectedByDrive = new Map<string, number>();
  for (const approach of approaches) {
    for (const stop of approach.stops) {
      detectedByDrive.set(stop.driveId, (detectedByDrive.get(stop.driveId) ?? 0) + stop.duration / 1000);
    }
  }

  const errors: number[] = [];
  const signed: number[] = [];
  const controlErrors: number[] = [];
  const queueOnlyDelays: number[] = [];
  const signalDelays: number[] = [];
  const classes = new Map<string, { scenarios: number; detected: number; errors: number[] }>();
  let detectable = 0;
  let detected = 0;
  let falsePositives = 0;

  for (const scenario of scenarios) {
    const truth = scenario.truth.stoppedSeconds;
    const estimate = detectedByDrive.get(scenario.drive.id);
    // Below the detector's own floor there is nothing to find, so counting a
    // miss there would measure the threshold rather than the estimator.
    const expectDetection = truth >= options.minStopDuration / 1000;
    const label = classify(scenario);
    const bucket = classes.get(label) ?? { scenarios: 0, detected: 0, errors: [] };
    bucket.scenarios++;

    if (expectDetection) {
      detectable++;
      if (estimate != null) {
        detected++;
        bucket.detected++;
        if (scenario.truth.stoppedByQueueOnly) queueOnlyDelays.push(estimate);
        else signalDelays.push(estimate);
        errors.push(Math.abs(estimate - truth));
        signed.push(estimate - truth);
        controlErrors.push(Math.abs(estimate - scenario.truth.controlDelaySeconds));
        bucket.errors.push(Math.abs(estimate - truth));
      }
    } else if (estimate != null) {
      falsePositives++;
    }
    classes.set(label, bucket);
  }

  return {
    scenarios: scenarios.length,
    detectable,
    detected,
    falsePositives,
    medianAbsError: median(errors),
    p90AbsError: quantile(errors, 0.9),
    maxAbsError: errors.length ? Math.max(...errors) : NaN,
    bias: signed.length ? signed.reduce((sum, value) => sum + value, 0) / signed.length : NaN,
    medianAbsErrorVsControlDelay: median(controlErrors),
    confound: {
      detectedStops: detected,
      causedByQueueAlone: queueOnlyDelays.length,
      fraction: detected ? queueOnlyDelays.length / detected : 0,
      medianQueueOnlyDelay: median(queueOnlyDelays),
      medianSignalDelay: median(signalDelays),
      shareOfDelay: (() => {
        const queueTotal = queueOnlyDelays.reduce((sum, value) => sum + value, 0);
        const signalTotal = signalDelays.reduce((sum, value) => sum + value, 0);
        return queueTotal + signalTotal > 0 ? queueTotal / (queueTotal + signalTotal) : 0;
      })(),
    },
    byClass: Object.fromEntries(Array.from(classes.entries(), ([label, bucket]) => [label, {
      scenarios: bucket.scenarios,
      detected: bucket.detected,
      medianAbsError: median(bucket.errors),
    }])),
  };
}

function classify(scenario: Scenario): string {
  if (scenario.truth.stoppedSeconds === 0) return 'no stop';
  if (scenario.truth.stoppedByQueueOnly) return 'queue on green';
  return scenario.truth.queueAhead > 0 ? 'red with queue' : 'red, no queue';
}
