# RoadAnalyzer — where things stand

Rewritten 2026-08-19. The previous version described a browser-based recorder
with an export API and a client-side sample buffer; that is not what this is any
more, and a document that is mostly wrong is worse than a short one that is
right. The old phase numbering is retired.

## What this is

An iPhone records a drive. The phone uploads it. The server map-matches the
trace onto real roads and works out where traffic actually costs you time.

```
iOS recorder ──> POST /api/mobile-reports ──> Drive + GpsSample + AccelerometerSample
                                              + TrafficTag + PausedInterval
                                                        │
                                     runTripAnalysis ───┤ Mapbox map matching
                                                        ├─> TripAnalysis + Maneuver
                                                        ├─> RoadSegment (tiles) + GpsSegmentMatch
                                                        └─> RouteTemplate assignment
                                                        │
                                    runDriveAnalysis ───┴─> CongestionEvent ──> SegmentStatistics
```

`GpsSample` is immutable raw data. Everything downstream is derived and can be
recomputed from it, which is what makes the backfill scripts safe.

### Pages

| Page | What it answers |
|---|---|
| `/map` | Where is traffic bad, aggregated across every drive |
| `/recordings` | One drive in detail: trace, stops, congestion, roughness |
| `/routes` | Which route templates exist and which drives belong to them |
| `/intersections` | Which junctions cost the most time per trip |
| `/segments` | Per-segment congestion history |
| `/matching` | Map-matching diagnostics |
| `/calibration` | Sensor baseline |

### The iOS recorder

`RoadAnalyzerIOS/` — SwiftUI, records GPS at 1 Hz and motion at 10 Hz, detects
stops live and asks the driver to label them, supports pause, and uploads with
retry. The driver's own labels are the most valuable data in the system:
everything else is inference.

## Done, and worth not re-litigating

- **Segment identity is tiles**, not Mapbox's OpenLR ids and not endpoint keys.
  A road is cut on a fixed ~557 m grid and a segment is one tile of one road, so
  the row count tracks road-kilometres covered rather than number of drives. See
  `docs/DESIGN_stable-segment-identity.md` §10 for why the endpoint key failed.
- **Route identity is edge-sequence similarity**, length-weighted, with the old
  geometry matcher kept as a fallback for drives whose matching is too sparse.
- **Intersections rank by cost per trip** — probability × median delay — with an
  exposure floor, because the metric says nothing on one traversal.
- **Congestion events break on the road, not the tile.** Tiles are a grid
  artefact; a jam does not end because you crossed a grid line.
- **Delay accuracy is measured**, not assumed: median 0.53 s, p90 1.08 s against
  a labelled corpus. `scripts/ground-truth/`.
- **OSM traffic controls are imported**, so junctions you never stop at exist.
  Driver tags stay authoritative and visibly distinct.
- **The recorder no longer degrades over a drive** — motion off the main queue,
  incremental route building, background persistence, bounded polyline.

## Known gaps

Each of these is understood and deliberately parked, not forgotten.

**`effectiveSpeed` is fragile to missing speed.** Its positional fallback cannot
tell a stopped car from a creeping one: 2.3 m of GPS scatter over a 1 s interval
reads as ~3 m/s, six times the stationary threshold, so stops shatter. Latent —
this recorder reports speed on every sample, measured 0 missing in 9701 — but a
10% dropout rate takes median delay error from 0.53 s to 6.86 s. Fixing it means
deciding what to do when displacement is smaller than measurement noise.

**No schedule for the OSM import.** `npm run import-osm-signals -- --apply` is
run by hand. Monthly is plenty; signals do not move. See `docs/OSM_SIGNALS.md`.

**Congestion events are tile-scoped, one drive at a time.** Fine, but it means a
jam spanning two tiles is two events. Re-detection is idempotent
(`scripts/redetect-congestion.ts`) if the boundary rule ever changes again.

**The queue-vs-signal confound is unresolved and quantified.** ~13.5% of detected
stops are caused by a queue discharging on green rather than by the signal, which
is 3.1% of measured delay. Stop probability carries nearly all of that error.
Separating the two would need signal timing we do not have and will not infer —
the driver's labels are better evidence than anything inferable from one car.

**The web recorder still exists** (`RecordingProvider`, `/api/recordings/start`,
`stop`, `sensor-data`). The iPhone is the real recorder now. Worth deciding
whether the browser path earns its keep or should go.

## Watch this

**Segment count should stay flat on repeat commutes.** It climbs only when you
drive somewhere new. Growth on a familiar route means the tiled write path is not
reusing rows, and that is the assumption everything downstream rests on.

## Operations

Everything that mutates stored data is dry-run by default and idempotent.

```
npm run dev                                     # local
npm test                                        # 185 tests, no network or database
npm run import-osm-signals -- --apply           # refresh OSM controls
npx tsx scripts/rebuild-segment-stats.ts --apply       # rebuild aggregates from events
npx tsx scripts/backfill-segment-identity.ts           # re-tile segments (dry run)
npx tsx scripts/redetect-congestion.ts                 # re-detect events (dry run)
npx tsx scripts/diff-route-matching.ts                 # compare route matchers
npx tsx scripts/osm-signal-coverage.ts                 # OSM against driver tags
npx tsx scripts/ground-truth/report.ts                 # delay accuracy
```

Migrations run on deploy (`prisma migrate deploy` in the build), against
`DATABASE_URL_UNPOOLED` — Neon's pooler cannot hold the advisory locks Prisma
Migrate takes.

## Ideas, unprioritised

Nothing here is committed to, and none of it is blocking.

- Export a drive as GPX or CSV. Asked for in the original plan, never built, and
  nothing has needed it since.
- Compare two drives of the same route side by side. The route templates make
  this newly meaningful — same road sequence, different day.
- Time-of-day and day-of-week views. `SegmentStatistics` already aggregates on
  both and nothing reads those rows.
- Denormalise a route template's edge sequence if the template count grows; it is
  derived from the reference drive on every analysis today.
- Direction-aware segments, if northbound and southbound congestion ever need
  telling apart. That is a data model change, not a dedupe.

### Explicitly rejected

Recorded so they do not get re-proposed. Self-hosted Valhalla or OSRM (Mapbox
Map Matching *is* OSRM's matcher; the problem was edge identity, not edge
finding). MobilityDB (Neon does not offer the extension). A separate Python
analytics worker (the analysis is already pure, unit-tested TypeScript).
ML-based signal-timing inference (those systems use millions of probe records
across millions of signals; we have one car, and the driver's confirmations are
better ground truth than anything we could infer).
