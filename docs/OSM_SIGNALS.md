# OSM traffic controls

`/intersections` is built from places you stopped, so it can only describe
junctions that have stopped you. A signal you catch one time in ten is thinly
represented; one you never catch does not exist. Importing
`highway=traffic_signals` and `highway=stop` from OpenStreetMap gives a
denominator of controls that does not depend on stopping, and a label that does
not depend on tagging.

It infers nothing about signal state or timing. Where a driver tag exists it
stays authoritative — a human confirming "that was a red light" as it happened
beats anything read off a map.

## Running it

```
npm run import-osm-signals              # show the regions that would be queried
npm run import-osm-signals -- --apply   # fetch from Overpass and cache
npx tsx scripts/osm-signal-coverage.ts  # cross-check against driver tags
```

**Refresh on a schedule, never per request.** Overpass is rate limited and
unreliable under load; a page that failed because a third-party API was busy
would be a bad trade for a label. Nothing in `app/` calls Overpass — the API
reads the `OsmSignal` table. Re-running monthly is plenty: signals do not move
often, and the import is idempotent on the OSM node id.

There is no cron wired up yet. Run it by hand after driving somewhere new, or
add it to whatever scheduler you prefer; the script is safe to run repeatedly.

## What the query does

One box per driven region, not one box over everything. A few stray drives in
Chicago, San Francisco and Portland stretch a single bounding box to
1685 × 3407 km — a third of a continent to find the signals on one commute.
`drivenBoundingBoxes` groups the driven road boxes and queries each separately;
today that is four regions totalling about 175 km².

Overpass answers 406 without a descriptive `User-Agent`, and 429 or 504 when its
slots are busy. Failures retry with backoff, and every region is fetched before
anything is written, so a rate limit leaves the cache exactly as it was rather
than half rewritten.

## What it found

688 controls cached: 454 signals, 234 stop signs. 184 of them sit on roads we
have driven.

Cross-checked against driver tags over the 38 approaches seen three or more
times:

- 28 approaches have an OSM control ahead of them
- **every** approach the driver tagged `RED_LIGHT` that matched agrees with OSM
- 5 approaches gain a label they did not have, from OSM alone
- 10 approaches have a driver tag but no OSM control within 90 m ahead — either
  the map is incomplete or the cluster is not at a junction
- **159 of the 184 controls on driven roads are associated with no approach at
  all.** Those are the junctions you get through. They were invisible to a
  pipeline seeded by stop events, which is the point of the import.

## Association

Distance alone attaches the same node to both stop lines of an intersection, and
worse, attaches the opposing approach's control to this one. What separates them
is that a driver stops *before* the control: the bearing from the cluster to the
node must agree with the direction of travel. Same node, opposite approaches,
different answers. `lib/osm-signals.test.ts` pins that, including the case where
the wrong control is the *nearer* one.
