# RoadAnalyzer

Measures what your commute actually costs you. An iPhone records a drive; the
server map-matches the trace onto real roads and works out which junctions and
which stretches take the most time out of an average trip.

It is a single-driver instrument, not a fleet product. That shapes most of the
decisions below: one car's data is thin, so the design leans on the driver's own
labels and on being honest about what it cannot measure.

## How a drive becomes an answer

```
iPhone recorder ──> POST /api/mobile-reports ──> Drive
                                                 ├─ GpsSample          (1 Hz, raw, immutable)
                                                 ├─ AccelerometerSample (10 Hz)
                                                 ├─ TrafficTag          (driver-confirmed stops)
                                                 └─ PausedInterval      (spans the driver removed)
                                                          │
                                    runTripAnalysis ──────┤  Mapbox map matching
                                                          ├─> TripAnalysis + Maneuver
                                                          ├─> RoadSegment (tiles) + GpsSegmentMatch
                                                          └─> RouteTemplate assignment
                                                          │
                                    runDriveAnalysis ─────┴─> CongestionEvent ──> SegmentStatistics
```

`GpsSample` is raw and never rewritten. Everything downstream is derived, which
is what makes the backfill scripts safe to re-run and what let the segment model
be replaced wholesale without touching a single recorded fix.

## The design decisions that matter

### Segments are tiles of a road, not matched extents

Mapbox returns whatever stretch a given drive covered, and its OpenLR references
are not stable between requests, so keying segments on them filed every re-drive
as a new road — 144 rows for 33 roads, one of them with 26 duplicates.

Keying on the road name plus rounded endpoints does not fix it either: the same
road came back as extents from 671 m to 7615 m, with endpoints kilometres apart.
There is no rounding that merges those without also merging different roads.

So identity does not come from the matched extent at all. A road is cut into
fixed tiles by a grid laid over the world (~557 m), and a segment is one tile of
one road. Whatever a drive matches, it lands on the same tiles as every other
drive over the same ground. The row count now tracks road-kilometres covered
rather than number of drives: re-driving your commute adds none.

See [`docs/DESIGN_stable-segment-identity.md`](docs/DESIGN_stable-segment-identity.md).

### Routes are ordered sequences of those tiles

Route identity used to be geometry proximity — 75 m of a stored centreline,
which is wider than the roads themselves. It is now a length-weighted longest
common subsequence over the tiles a drive used, so order counts and the answer
says *where* two routes diverged rather than only how much.

Direction falls out of it: the same roads driven the other way score ~0.16
against a 0.45 threshold. A route is one-way.

### Intersections rank by cost per trip

`probability × median delay`. Stop probability alone over-weights a light you
always catch but that releases you quickly; total delay alone mostly measures
how often you have driven the road. Exposure is filtered separately, because the
metric says nothing on a single traversal.

### The driver's labels outrank inference

The phone detects a stop and asks what it was. A junction answered consistently
enough auto-tags itself, and asks again periodically so a changed junction is
caught rather than asserted from memory. OpenStreetMap controls are imported for
coverage, but they are shown as clearly distinct from what the driver said.

This is also why there is no signal-timing inference here. Those systems use
millions of probe records across millions of signals; this is one car, and a
human confirming "that was a red light" as it happened is better evidence than
anything inferable from it.

### Accuracy is measured, not assumed

`scripts/ground-truth/` generates labelled approaches whose true delay is known
by construction, and reports the error distribution: **median 0.53 s, p90
1.08 s** over 500 scenarios, with a committed baseline the test suite fails
against on regression. It also quantifies what the pipeline *cannot* separate —
a vehicle held by a queue on green looks identical to one held by the signal, and
that accounts for 13.5% of detected stops but only 3.1% of measured delay.

## The iPhone recorder

[`RoadAnalyzerIOS`](RoadAnalyzerIOS) — SwiftUI, sideloaded from Xcode. Point
`RoadAnalyzerAPIBaseURL` in `Info.plist` at your deployment first.

- GPS at 1 Hz and motion at 10 Hz, continuing in the background
- Live stop detection with a tagging prompt sized for a glance at a mounted phone
- **Pause** for a fuel stop or an errand: GPS goes off, and the span is excluded
  from duration, distance, the drawn route and the analysis
- **Smart end**: a drive that has not moved for five minutes asks whether it is
  over and ends itself two minutes later if nobody answers — at the moment the
  car last moved, not when the app noticed, and it notifies you that it did
- Uploads with retry, and holds a drive back until its stops are tagged

`RoadAnalyzerIOS/Tests` compiles the real detector sources for macOS and runs
synthetic traces through them, so stop-detection behaviour can be changed with
something other than hope:

```bash
./RoadAnalyzerIOS/Tests/run.sh
```

Ingest at `POST /api/mobile-reports` is **unauthenticated**, which is fine for a
personal sideload and not fine for anything else. Add authentication and rate
limiting before exposing it.

## The web app

| Page | What it answers |
|---|---|
| `/map` | Where traffic is bad, aggregated across every drive |
| `/recordings` | One drive: trace, stops, congestion, roughness |
| `/routes` | Which route templates exist, and which drives belong to them |
| `/intersections` | Which junctions cost the most time per trip |
| `/segments` | Per-segment congestion history |
| `/matching` | Map-matching diagnostics |
| `/calibration` | Accelerometer baseline for road-quality scoring |

Recording happens on the phone. The browser recorder that predated it was
removed once it had no users left.

## Tech stack

Next.js 14 (App Router) · PostgreSQL on Neon with Prisma · Tailwind + shadcn/ui ·
Mapbox GL JS and Map Matching v5 · Recharts · Turf.js · Vercel · SwiftUI

## Running it

```bash
npm install
cp .env.example .env      # then set DATABASE_URL and the Mapbox tokens
npx prisma migrate dev
npm run dev
```

```env
DATABASE_URL="postgresql://user:password@host/db?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:password@host/db?sslmode=require"
MAPBOX_ACCESS_TOKEN="pk.server-token-with-navigation-scope"
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="pk.public-url-restricted-token"
```

Migrations need `DATABASE_URL_UNPOOLED`: Neon's pooler runs PgBouncer in
transaction mode, which cannot hold the session-level advisory locks Prisma
Migrate takes. Deploys run `prisma migrate deploy` as part of the build.

```bash
npm test                  # 185 tests, no network and no database
npm run lint
```

## Operations

Everything that mutates stored data is **dry-run by default and idempotent**.
Run it, read what it says it will do, then pass `--apply`.

```bash
npm run import-osm-signals -- --apply                # refresh OSM traffic controls
npx tsx scripts/rebuild-segment-stats.ts --apply     # rebuild aggregates from events
npx tsx scripts/backfill-segment-identity.ts         # re-tile segments
npx tsx scripts/redetect-congestion.ts               # re-detect congestion events
npx tsx scripts/diff-route-matching.ts               # compare route matchers over history
npx tsx scripts/osm-signal-coverage.ts               # OSM controls against driver tags
npx tsx scripts/ground-truth/report.ts               # delay-estimate accuracy
npx tsx scripts/investigate-untagged-stops.ts        # stops the phone detected but never tagged
```

## Data model

| Model | Holds |
|---|---|
| `Drive` | One recording session, with computed statistics |
| `GpsSample` / `AccelerometerSample` | Raw 1 Hz and 10 Hz sensor data |
| `TrafficTag` | A stop the driver labelled, with its approach heading |
| `PausedInterval` | A span the driver removed from the drive |
| `RoadSegment` | One tile of one road, keyed on `spatialKey` |
| `GpsSegmentMatch` | Which tile each sample was on |
| `TripAnalysis` / `Maneuver` | Matched geometry, coverage, direction, named turns |
| `CongestionEvent` | A detected slowdown, attributed to a tile |
| `SegmentStatistics` | Pre-aggregated by day of week and hour |
| `RouteTemplate` | A named route, identified by its reference drive's tile sequence |
| `OsmSignal` | A traffic control imported from OpenStreetMap |

## Known limitations

Written down because they are real, and because the alternative is rediscovering
them later.

- **`effectiveSpeed` is fragile to missing speed.** Its positional fallback
  cannot separate a stopped car from a creeping one — 2.3 m of GPS scatter over
  1 s reads as ~3 m/s. Latent: this recorder reports speed on every sample. At a
  10% dropout rate, median delay error goes from 0.53 s to 6.86 s.
- **The queue-versus-signal confound is unresolved**, and quantified above.
- **The OSM import has no schedule.** Run it by hand after driving somewhere new.
- **Delay means stopped time**, not the traffic-engineering definition of control
  delay, which additionally counts the time lost braking and accelerating —
  around 7 s a stop.

[`TODO.md`](TODO.md) tracks these alongside anything in flight.

## License

MIT
