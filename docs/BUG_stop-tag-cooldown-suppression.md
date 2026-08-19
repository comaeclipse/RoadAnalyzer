# Bug: closely-spaced stops are silently dropped by the 45s rearm cooldown

**Area:** iOS — `RoadAnalyzerIOS/RoadAnalyzer/StopDetector.swift`
**Severity:** High — genuine stops are lost with no prompt and no review, so they never reach the server. Data loss, not just a UI miss.
**Status:** Fixed 2026-08-19 in 76e4f65 — see Resolution.
**Filed:** 2026-08-17
**Reported by:** driver observation ("stop, drive ≤30mph, stop again → no tag prompt"), confirmed against 8/16–8/17 drive data.

## Summary

After the driver leaves a stop, the detector opens a **45-second window during which the next stop is marked `suppressed`**. A suppressed stop never prompts, never auto-tags, and never appears in post-trip review — it is dropped entirely and is never uploaded. Two intersections a short distance apart are reached within 45s of each other at any normal speed, so the **second** stop is routinely lost.

## Steps to reproduce

1. Stop at a red light / stop sign (gets prompted and tagged — correct).
2. Proceed at a normal city speed (≤ ~30mph).
3. Stop again at the next controlled intersection within ~45s (roughly < 400m at 20–30mph).
4. **Expected:** the second stop is prompted for a tag.
   **Actual:** no prompt; the second stop is silently discarded.

## Evidence (real drives, 8/16–8/17)

Reconstructed every stop from the raw GPS speed trace (≥2s stationary — the same threshold the phone prompts on) and cross-referenced against the tags that were actually saved. **4 genuine stops across 3 drives were never tagged, and every one of them occurred within 45s of the previous stop:**

| Drive | Untagged stop | Stationary | Gap since prev stop | Preceding (tagged) stop |
|---|---|---|---|---|
| 8/16 3:23pm | 3:43:34pm (30.39660, -87.27794) | 14s + 36s* | 30s | 95s red light, then 272m away |
| 8/16 3:46pm | 3:49:15pm (30.39782, -87.27761) | 21s | 32s | 74s red light, 293m away |
| 8/17 7:16am | 7:37:18am (30.47782, -87.26618) | 10s | 37s | 11s red light, 251m away |

*Two fragments 5m apart — the same junction, one ~50s stop.

**Key signal:** not a single untagged stop had a gap greater than 45s. Random dismissals or prompt timeouts would scatter across all gap sizes; instead they cluster entirely under 45s, which is the fingerprint of the cooldown window specifically.

Reproduce with: `npx tsx scripts/investigate-untagged-stops.ts`

## Root cause

`StopDetector.swift`:

```swift
// line 30
static let rearmCooldown: TimeInterval = 45
```

On departure the window is armed (line ~174):

```swift
state = .moving
cooldownUntil = now.addingTimeInterval(Self.rearmCooldown)
```

On the next confirm, any stop inside the window is suppressed (lines ~191–192):

```swift
let inCooldown = cooldownUntil.map { now < $0 } ?? false
let suppressed = inCooldown || isInCluster(anchor, now: now)
```

And a suppressed stop is never surfaced:
- No live prompt / no auto-tag — `RecordingStore.handle(.confirmed)` gates on `event.suppressed != true` (RecordingStore.swift ~L477).
- No review — `RecordingSession.untaggedStops` excludes `suppressed` (Models.swift ~L251).

### Why the cooldown is redundant and too aggressive

The window was meant to absorb stop-and-go **chatter** (creeping forward in a queue). But that case is already covered:

- **The departure gate already requires a *real* departure** — >30m travelled *and* >6 m/s (13.4mph) — before the cooldown is ever armed. A slow queue creep rarely exceeds 6 m/s, so it never departs in the first place; it stays one `.stopped` traversal. So by the time the cooldown arms, the driver has genuinely driven off.
- **Cluster suppression already handles real jams** — 3 stops within 180s and 200m (`clusterCount` / `clusterWindow` / `clusterRadius`).

The 45s time-only window therefore does little the cluster logic doesn't, while destroying the legitimate **second** stop at two lights a block apart — which cluster suppression (needing a *third* stop) would never have touched.

## Recommended solution

**Make the cooldown distance-aware instead of time-only: only suppress a quick re-stop that is essentially the *same place* the driver just left (a queue creep), never a new junction down the road.**

Concretely:
1. When departing, remember the departure location alongside `cooldownUntil`.
2. In `confirm()`, treat `inCooldown` as suppressing **only if** the new anchor is within a small radius of the departure point (reuse `departureDistance` = 30m, or a dedicated ~50m constant). Beyond that radius it is a distinct stop and must prompt.

This preserves the anti-chatter intent (a real creep re-stops within a few metres) while fixing every case in the evidence table (all 235–293m away).

```swift
// sketch
case .stopped(let id, let at, let minimumSpeed):
    ...
    state = .moving
    cooldownUntil = now.addingTimeInterval(Self.rearmCooldown)
    cooldownAnchor = sample            // <-- remember where we drove off
    return .departed(...)

// in confirm():
let nearDeparture = cooldownAnchor.map {
    TrafficAnalyzer.distance($0.latitude, $0.longitude, anchor.latitude, anchor.longitude) <= Self.departureDistance
} ?? false
let inCooldown = (cooldownUntil.map { now < $0 } ?? false) && nearDeparture
```

### Alternatives considered
- **Drop `rearmCooldown` to ~5–8s** — simpler; absorbs only immediate creep, leans on cluster suppression for jams. Loses the "same-place" precision but fixes the reported cases.
- **Remove the cooldown entirely** — rely solely on cluster suppression (3/180s/200m). Cleanest, but the 2nd rapid stop in a hard-accelerated pair would now always prompt (arguably correct).

Distance-aware is preferred: it keeps the original intent intact and is the narrowest change.

## Test plan

Add to the detector's synthetic-trace suite:
- **Regression:** stop → depart (>30m, >13.4mph) → stop again 235m away within 45s ⇒ **both** confirmed and **not** suppressed.
- **Preserve:** stop → brief creep (<30m, re-stop within a few metres) within 45s ⇒ second stop still suppressed.
- **Preserve:** 3+ stops within 180s/200m ⇒ cluster suppression still fires.

## Scope / caveats

- iOS detection only. **Not retroactive** — the 4 stops already dropped were never uploaded and cannot be recovered; the fix only affects future drives.
- Web/server post-hoc analysis (`lib/intersection-stops.ts`) is unaffected — it reconstructs stops from GPS independently and already sees these stops.

---

## Resolution (2026-08-19, 76e4f65)

Took the recommended fix: the cooldown is distance-aware rather than time-only.

```swift
// StopDetector.swift
static let cooldownRadius = 50.0
private var cooldownAnchor: LocationSample?

// on departure
cooldownAnchor = at            // the stop just left, not the fix that left it

// in confirm()
let inCooldown = (cooldownUntil.map { now < $0 } ?? false) && nearDeparture(anchor)
let suppressed = inCooldown || isInCluster(anchor, now: now)
```

Both halves are required now: recently, **and** essentially where the driver
already was. Creeping forward in a queue satisfies both; the next junction along
satisfies only the first, and is a real stop.

`cooldownAnchor` is the stop's own anchor rather than the departing fix. Leaving
requires more than 30 m of travel, so anchoring on the departing fix would put
the radius 30 m further down the road for no reason and shift what counts as
"the same place" by the length of the departure gate.

Cluster suppression is unchanged, and still the thing that handles real jams.

### Tests

`RoadAnalyzerIOS/Tests` is new, and exists because of this bug: the fix is a
behavioural change to a state machine, and asserting it by reading the diff is
not the same as running it. `StopDetector` and `TrafficAnalyzer` are pure value
types over `LocationSample`, so the harness compiles **the real sources** for
macOS and drives synthetic traces through them — no simulator, no car, no red
light, and nothing copied that can drift out of step with what ships. The single
concession is `#if canImport(UIKit)` around the one UIKit use in `Models.swift`.

```
./RoadAnalyzerIOS/Tests/run.sh
```

Covers the three cases the test plan above asked for, plus the two baselines
(one light is one stop; a roll-through is not a stop). 10/10.

**The regression test has teeth.** Reverting just the `&& nearDeparture(anchor)`
clause and re-running gives:

```
ok   two junctions 250 m apart both confirm (got 2)
FAIL neither is suppressed (suppressed: [false, true])
```

`[false, true]` is precisely the reported failure: the first light prompts, the
second is silently dropped.

Two of the fixtures in the original test plan needed correcting while writing
them, and the corrections are worth recording because they say something about
the code:

- The "brief creep" case as specified — *re-stop within a few metres* — cannot
  happen. Leaving a stop requires **both** >30 m travelled and >6 m/s, so a car
  that has only crept a few metres never departed and is still the same stop. The
  fixture that actually exercises the cooldown is a departure of just over 30 m
  followed by a re-stop inside the 50 m radius.
- The cluster fixture needs **four** stops, not three: `isInCluster` counts
  *previous* stops within 200 m of the new one, so a third stop only has two
  neighbours to find.

### Verifying on real data

`npx tsx scripts/investigate-untagged-stops.ts` still reproduces, but note its
window is **start of yesterday to now** — the 8/16–8/17 evidence drives are
outside it. Reading immediately after the fix, across the 4 drives in window:
**0 untagged stops**. That is a clean starting point rather than proof; those
drives may simply not have had two controls inside 45 s of each other.

The confirmation is a future drive that does. A drive showing `UNTAGGED STOPS`
above zero, where the gap to the previous stop is under 45 s, would mean this is
still wrong.

### Not recovered

The 4 stops already dropped were never uploaded and cannot be recovered. Nothing
retroactive was attempted.
