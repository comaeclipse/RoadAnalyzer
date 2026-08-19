# Ground truth for delay estimates

`lib/intersection-stops.test.ts` pins behaviour. It cannot say whether a delay
number is *right*, because every value it asserts is one we chose while writing
the fixture. This directory exists to ask the other question: given a vehicle
that truly stopped for 39 s, do we report 39 s?

## Running it

```
npx tsx scripts/ground-truth/report.ts          # 500 scenarios
npx tsx scripts/ground-truth/report.ts 5000     # more
npx tsx scripts/ground-truth/report.ts 500 --missing 0.1   # with speed dropouts
npx tsx scripts/ground-truth/measure-noise.ts   # re-derive the noise model (needs the database)
```

The corpus is generated from a seed by `lib/ground-truth.ts`, so `npm test`
needs no fixture files, no simulator, and no network. `measure-noise.ts` is the
only script here that touches the database, and only to re-derive the noise
constants after a recorder change.

## Why not SUMO

The plan called for Eclipse SUMO, and SUMO would be the right tool for questions
about *traffic* — it gives realistic car-following, queue discharge, and
shockwave propagation. The question here is about our *estimator*, and for that
truth computed analytically is better than truth measured out of a simulation:
it is exact, it needs no install, and the corpus reproduces from a seed rather
than from a checked-in blob. The queue model is the standard startup-lost-time
and saturation-headway formulation a microsimulator approximates anyway.

What that costs: no heterogeneous drivers, no lane changes, no shockwaves. If a
question ever turns on those, a `generateFromSumo` writing the same `Scenario`
shape drops in beside `generateScenario` without disturbing anything else.

## The noise model

Synthetic traces are degraded to match ten real recorded drives:

| | measured |
|---|---|
| sample interval | 1000 ms, p05 through p95 |
| accuracy | median 2.3 m, p90 7.9 m, max 26.5 m |
| missing speed | 0 of 9701 samples |
| speed at rest | median 0.000, p90 0.094 m/s |

A trace cleaner than this passes tests that real data would fail.

## What it found

Baseline over 500 scenarios, recorded in
`lib/intersection-delay-accuracy.test.ts`:

```
detection    100.0% of stops above the 2 s floor, 0 false positives
median error 0.53 s
p90 error    1.08 s
bias         -0.51 s
```

Two findings beyond the baseline:

**The estimator is fragile to missing speed.** Drop a tenth of the speed
readings and the median error goes from 0.53 s to 6.86 s, bias -7.22 s.
`effectiveSpeed` falls back to differencing positions, and 2.3 m of scatter over
a 1 s interval reads as about 3 m/s — six times the stationary threshold — so a
stopped vehicle appears to move and its stop shatters into sub-2 s pieces.
Latent, not live: this recorder drops no speeds. Resolving it means deciding
what to do when a displacement is smaller than the measurement noise, where
standing still and creeping at 1 m/s are genuinely indistinguishable in one
second of fixes.

**The queue confound costs count, not time.** 13.5% of detected stops were
caused by a queue still discharging on green rather than by the signal — but
their median delay is 7.0 s against 36.0 s for signal stops, so they are only
3.1% of measured delay. Stop probability carries nearly all of the error and
median delay almost none. That matters now that `/intersections` ranks by
probability × median delay: the multiplier is inflated, the multiplicand is not.
The fraction is a property of the traffic and so depends on the scenario mix;
what does not is that the pipeline reports both kinds identically.
