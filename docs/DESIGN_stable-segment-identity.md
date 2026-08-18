# Scope: write-time stable segment identity

**Status:** proposal / not started
**Goal:** stop the ingest pipeline from creating duplicate `RoadSegment` rows for
the same physical stretch of road, so the read-layer dedupe
([lib/segment-dedupe.ts](../lib/segment-dedupe.ts)) becomes a safety net instead of
the thing holding the map together.

---

## 1. Root cause (confirmed in code)

`RoadSegment` identity is the merge key in `upsertEdges`
([lib/trip-analysis.ts:150](../lib/trip-analysis.ts#L150)):

```ts
prisma.roadSegment.upsert({
  where: { source_sourceId: { source: 'MAPBOX', sourceId: edge.sourceId } },
  ...
})
```

`edge.sourceId` is a Mapbox **OpenLR `linear_references`** string
([lib/map-matching.ts:101](../lib/map-matching.ts#L101),
[:267–288](../lib/map-matching.ts#L267)). OpenLR encodings are **not stable across
requests** — the same stretch driven again comes back with a different reference
(different sub-metre snapping, opposite direction, different chunk boundaries), so
the `@@unique([source, sourceId])` key ([schema.prisma:176](../prisma/schema.prisma#L176))
treats it as a new segment. Result on current prod data: **55 all-time segment rows
for 23 real roads**; "New Warrington Road" alone had 9 rows.

## 2. Blast radius — everything keyed on the segment id

If we change how a physical stretch maps to a `RoadSegment.id`, four writers inherit it:

| Table | How it references a segment | Migration concern |
|---|---|---|
| `RoadSegment` | the row itself, upserted on `(source, sourceId)` | change the merge key |
| `GpsSegmentMatch` | `segmentId` per GPS sample; `@@unique([gpsId, segmentId])` ([schema:222](../prisma/schema.prisma#L222)) | **repointing can collide** — one sample matched to two dup segments → two rows → same canonical id |
| `CongestionEvent` | `segmentId`, taken from `segmentMatches[0]` ([post-processing.ts:302](../lib/post-processing.ts#L302)); **no unique on segmentId** | safe plain `UPDATE` |
| `SegmentStatistics` | `segmentId`; `@@unique([segmentId, dayOfWeek, hourOfDay, weekStart])` | not repointed — **fully rebuilt** from events via [scripts/rebuild-segment-stats.ts](../scripts/rebuild-segment-stats.ts) |

## 3. Options for a stable identity

**A. Deterministic spatial key (recommended).** Compute a `spatialKey` from the
edge geometry + normalized name, store it, and upsert on `(source, spatialKey)`
instead of `(source, sourceId)`. Keep `sourceId` as non-unique provenance.
- + Pure function → unit-testable; **race-safe** (the unique constraint collapses
  concurrent inserts of the same stretch — the current `sourceId` key does not
  protect us because the ids differ).
- − Hash/grid keys can split at a rounding boundary (two copies straddling a grid
  line get different keys). Mitigated by coarse rounding **and** by keeping the
  read-layer dedupe as a net.

**B. Spatial nearest-segment reuse at write.** On each edge, query existing
segments by bbox (index exists, [schema:177](../prisma/schema.prisma#L177)) and reuse
the id of any that is `coincident` (the exact test already in
[lib/segment-dedupe.ts](../lib/segment-dedupe.ts)); else create.
- + Best tolerance for geometry drift; reuses validated overlap logic.
- − **Race window**: two simultaneous drives both find nothing, both insert → dup
  returns. Needs the deterministic key anyway to be safe.

**C. OSM way id.** Truly stable, but Mapbox map-matching doesn't return it
reliably; would need an OSM/Overpass lookup. **Out of scope** — separate project.

**Recommendation: A**, with the `coincident` geometry test from Option B reused
inside the backfill for clustering. Keep read-layer dedupe as defense-in-depth.

## 4. Proposed `spatialKey` (deterministic)

```
key = normalizedName + "|" + sortedRoundedEndpoints
  normalizedName        = name.trim().toLowerCase().replace(/\s+/g,' ')
  roundedEndpoint(p)    = `${p[0].toFixed(4)},${p[1].toFixed(4)}`   // ~11 m grid
  sortedRoundedEndpoints= [round(start), round(end)].sort().join(';') // direction-independent
```

Same name + same ~11 m start/end (either direction) → same key. Tunable precision.
Lives in a new pure module `lib/segment-identity.ts` with tests mirroring the three
cases already covered in [lib/segment-dedupe.test.ts](../lib/segment-dedupe.test.ts)
(merge coincident copies; don't merge crossing roads; don't merge adjacent tiles).

## 5. Open decisions (need a call before building)

1. **Direction-aware segments?** Today segments are direction-agnostic and the
   read-layer dedupe merges both ways. If northbound vs southbound congestion should
   be distinguished, the key must include a bearing bucket and this becomes a data
   *model* change, not just a dedupe. **Default assumption: keep direction-agnostic**
   (matches current behavior).
2. **Unnamed roads.** `name` falls back to `'Unnamed road'`
   ([map-matching.ts:283](../lib/map-matching.ts#L283)). Keying those on name+geometry
   risk-merges unrelated unnamed stubs. Options: exclude from merging (geometry-only
   with tighter tolerance) or leave them un-deduped.
3. **Precision / tolerance** (4 dp ≈ 11 m) — one number, tune against prod.
4. **Keep the read-layer dedupe?** Recommend **yes**, as a net for residual
   grid-boundary splits and pre-migration rows.

## 6. Migration / backfill (the hard part)

Existing duplicate rows must be compacted once. Order matters — repoint before delete
(deletes cascade events + matches, [schema:210](../prisma/schema.prisma#L210),
[:304](../prisma/schema.prisma#L304)).

1. Add nullable `spatialKey` column; backfill it for all `source='MAPBOX'` rows.
2. Cluster by `spatialKey`; pick a **canonical** per cluster (longest geometry).
3. **Repoint `CongestionEvent.segmentId`** → canonical (plain UPDATE).
4. **Repoint `GpsSegmentMatch`** → canonical, **de-colliding** on `(gpsId,
   segmentId)`: keep the nearest-distance row, drop the rest.
5. Delete non-canonical `RoadSegment` rows (their now-orphaned matches/events are
   already repointed).
6. `npx tsx scripts/rebuild-segment-stats.ts` to rebuild `SegmentStatistics` clean.
7. Add `@@unique([source, spatialKey])`; drop the upsert's reliance on
   `(source, sourceId)`.

Write as an idempotent, dry-run-first script (like the SF-drive prune) run against a
DB snapshot first.

## 7. Code changes

- `lib/segment-identity.ts` (new) — `spatialKeyFor(edge)` + tests.
- `prisma/schema.prisma` — add `spatialKey String?`, add `@@unique([source, spatialKey])`,
  relax the `sourceId` uniqueness; one migration.
- `lib/trip-analysis.ts` `upsertEdges` — compute `spatialKey`, upsert on it, store
  `sourceId` as provenance.
- `scripts/backfill-segment-identity.ts` (new) — section 6, dry-run + apply.
- Keep `lib/segment-dedupe.ts` wired in the heatmap as a net (optionally relax its
  thresholds once write-time dedup lands).

## 8. Effort, risk, sequencing

- **Effort:** ~1–1.5 days. Identity fn + upsert change ≈ 2–3 h; migration script +
  careful testing ≈ half+ day (the collision handling and cascade ordering are where
  bugs hide); schema migration + verification ≈ 2 h.
- **Risk:** medium — it mutates prod ingest + rewrites existing rows. Mitigations:
  dry-run the backfill on a snapshot, event totals must be conserved (same invariant
  the dedupe verify used: 103→103), read-layer dedupe stays as a net, ship the code
  change and backfill in one window so new writes don't repopulate old dup ids.
- **Sequencing:** (1) identity fn + tests → (2) upsert change behind it (new rows
  clean immediately) → (3) backfill existing data → (4) add unique constraint → (5)
  re-measure; consider loosening the read-layer net.

## 9. Do-nothing alternative

The read-layer dedupe already yields a correct map (55→36, events conserved) and is
self-healing. The **only** things the write-time fix additionally buys: (a) segment
ids stable across time so per-segment history/trends don't fragment, (b) smaller
tables / less per-request dedupe work as data grows, (c) `SegmentStatistics` that are
correct at the row level (useful if other features read them directly, e.g.
[app/api/segments](../app/api/segments)). If none of those are near-term needs, this
can wait.
