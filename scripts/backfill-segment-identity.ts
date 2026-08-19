/**
 * Re-tile RoadSegment onto stable identity.
 *
 * Rows were keyed on Mapbox's OpenLR sourceId, which changes between matches of
 * the same road, so one physical stretch accumulated a row per drive. Identity
 * now comes from lib/segment-identity.ts: a road cut into fixed grid tiles, one
 * row per tile. This script builds those rows from the geometry already stored,
 * moves every reference onto them, and removes the old rows.
 *
 * Each GpsSegmentMatch is re-filed by where its sample actually is -- the
 * snapped position it was matched at, falling back to the raw fix -- so a
 * sample lands on the tile covering the ground it was on. Congestion events
 * follow their own first sample.
 *
 * Order matters. Deleting a RoadSegment cascades to its CongestionEvent and
 * GpsSegmentMatch rows, so everything is repointed before anything is deleted.
 * GpsSegmentMatch is unique on (gpsId, segmentId): two matches for one sample
 * can land on one tile, so the nearer is kept and the rest dropped.
 *
 * Unnamed edges keep their old rows. There is nothing to tell two unnamed stubs
 * in one cell apart, so merging them would invent a road.
 *
 * Idempotent: a second run finds every tile already present and nothing to move.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-segment-identity.ts             # report only
 *   npx tsx scripts/backfill-segment-identity.ts --apply     # re-tile
 *
 * After --apply, rebuild the aggregates, which are keyed on segmentId and are
 * not repointed:
 *
 *   npm run rebuild-segment-stats -- --apply
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import * as turf from '@turf/turf';
import { prisma } from '../lib/prisma';
import { calculateBoundingBox } from '../lib/segment-matching';
import { tileEdge, tileKeyAt, type SegmentTile } from '../lib/segment-identity';

const APPLY = process.argv.includes('--apply');

interface SegmentRow {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  sourceId: string | null;
  spatialKey: string | null;
}

function lengthMeters(geometry: GeoJSON.LineString): number {
  if (!geometry?.coordinates || geometry.coordinates.length < 2) return 0;
  return turf.length(turf.lineString(geometry.coordinates), { units: 'meters' });
}

async function main() {
  const segments = (await prisma.roadSegment.findMany({
    where: { source: 'MAPBOX' },
    select: { id: true, name: true, geometry: true, sourceId: true, spatialKey: true },
    orderBy: { createdAt: 'asc' },
  })) as unknown as SegmentRow[];

  const nameById = new Map(segments.map((segment) => [segment.id, segment.name]));

  // Rows already carrying a key are tiles from an earlier run. They are the
  // destination, not the input: re-tiling one would produce itself, and then
  // classifying it as a source row would delete the very row everything was
  // just repointed at. This is what makes a second run a no-op.
  const existingTiles = segments.filter((segment) => segment.spatialKey !== null);
  const legacy = segments.filter((segment) => segment.spatialKey === null);

  // Every tile the legacy geometry covers, keeping the longest description of
  // each — the same rule the write path uses.
  const tiles = new Map<string, SegmentTile & { name: string }>();
  const untiled: SegmentRow[] = [];
  for (const segment of legacy) {
    const produced = tileEdge(segment);
    if (produced.length === 0) {
      untiled.push(segment);
      continue;
    }
    for (const tile of produced) {
      const existing = tiles.get(tile.key);
      if (!existing || tile.geometry.coordinates.length > existing.geometry.coordinates.length) {
        tiles.set(tile.key, { ...tile, name: segment.name });
      }
    }
  }

  // A row that produced no tiles is either unnamed or a degenerate stub a few
  // metres long. Where the same road has real tiles, the stub's samples belong
  // on them and the row goes; where it does not, there is nowhere to move them
  // and the row stays exactly as it is.
  // A stub may also belong on a tile an earlier run already created.
  const tiledRoads = new Set([
    ...Array.from(tiles.values(), (tile) => tile.name),
    ...existingTiles.map((segment) => segment.name),
  ]);
  const stranded = untiled.filter((segment) => !tiledRoads.has(segment.name));
  const strandedIds = new Set(stranded.map((segment) => segment.id));

  console.log(`MAPBOX road segments: ${segments.length}`);
  console.log(`  already tiled by an earlier run: ${existingTiles.length}`);
  console.log(`  tiles the remaining rows cover: ${tiles.size}`);
  console.log(`  rows with no road to move to, left alone: ${stranded.length}`);
  console.log(`  stubs folded into a tile of the same road: ${untiled.length - stranded.length}`);
  console.log(`  rows to delete once repointed: ${legacy.length - stranded.length}`);

  const lengths = Array.from(tiles.values(), (tile) => lengthMeters(tile.geometry)).sort((a, b) => a - b);
  if (lengths.length) {
    const at = (fraction: number) => Math.round(lengths[Math.floor(lengths.length * fraction)]);
    console.log(`  tile length m: min ${Math.round(lengths[0])} median ${at(0.5)} max ${Math.round(lengths[lengths.length - 1])}`);
  }

  if (tiles.size) {
    const byName = new Map<string, number>();
    for (const tile of tiles.values()) byName.set(tile.name, (byName.get(tile.name) ?? 0) + 1);
    console.log('  roads with most tiles: ' + Array.from(byName.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => `${name} (${count})`).join(', '));
  }

  const doomedIds = legacy
    .filter((segment) => !strandedIds.has(segment.id))
    .map((segment) => segment.id);
  const doomed = new Set(doomedIds);

  if (doomedIds.length === 0) {
    console.log('\nEvery row is already a tile or has nowhere to go — nothing to do.');
  }

  // Where each match ends up: the tile covering the position it was matched at.
  const matches = await prisma.gpsSegmentMatch.findMany({
    where: { segmentId: { in: doomedIds } },
    select: {
      id: true,
      gpsId: true,
      segmentId: true,
      distance: true,
      snappedLatitude: true,
      snappedLongitude: true,
      gps: { select: { latitude: true, longitude: true } },
    },
  });

  // Tiles an earlier run created are destinations too, so a stub left behind
  // then can be folded in now.
  for (const segment of existingTiles) {
    if (segment.spatialKey && !tiles.has(segment.spatialKey)) {
      tiles.set(segment.spatialKey, {
        key: segment.spatialKey,
        geometry: segment.geometry,
        name: segment.name,
      });
    }
  }

  const targetKeyByMatch = new Map<string, string>();
  let unplaceable = 0;
  for (const match of matches) {
    const name = nameById.get(match.segmentId) ?? '';
    const position: GeoJSON.Position = match.snappedLongitude != null && match.snappedLatitude != null
      ? [match.snappedLongitude, match.snappedLatitude]
      : [match.gps.longitude, match.gps.latitude];
    const key = tileKeyAt(name, position);
    // A sample just outside every tile this road produced — the road grazed the
    // cell and got no tile there. Fall back to the nearest tile of the same road.
    const resolved = key && tiles.has(key) ? key : nearestTileKey(name, position, tiles);
    if (!resolved) {
      unplaceable++;
      continue;
    }
    targetKeyByMatch.set(match.id, resolved);
  }

  // Collisions: two matches for one sample landing on one tile.
  const byTarget = new Map<string, { id: string; distance: number }[]>();
  for (const match of matches) {
    const key = targetKeyByMatch.get(match.id);
    if (!key) continue;
    const composite = `${match.gpsId}:${key}`;
    const bucket = byTarget.get(composite);
    if (bucket) bucket.push({ id: match.id, distance: match.distance });
    else byTarget.set(composite, [{ id: match.id, distance: match.distance }]);
  }
  const collisions = Array.from(byTarget.values()).filter((rows) => rows.length > 1);
  const dropped = collisions.reduce((total, rows) => total + rows.length - 1, 0);

  const events = await prisma.congestionEvent.findMany({
    where: { segmentId: { in: doomedIds } },
    select: { id: true, segmentId: true, startGpsId: true },
  });

  console.log(`\nGpsSegmentMatch rows to re-file: ${matches.length}`);
  console.log(`  dropped as duplicates on one tile: ${dropped}`);
  console.log(`  with nowhere to go: ${unplaceable}`);
  console.log(`CongestionEvent rows to repoint: ${events.length}`);

  const eventsBefore = await prisma.congestionEvent.count();
  const durationBefore = (await prisma.congestionEvent.aggregate({ _sum: { duration: true } }))._sum.duration;

  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    console.log('Re-run with --apply to re-tile:');
    console.log('  npx tsx scripts/backfill-segment-identity.ts --apply');
    return;
  }

  // 1. The tile rows. Reuse any an earlier run already made.
  const idByKey = new Map<string, string>();
  for (const row of existingTiles) if (row.spatialKey) idByKey.set(row.spatialKey, row.id);

  for (const [key, tile] of tiles) {
    if (idByKey.has(key)) continue;
    const created = await prisma.roadSegment.create({
      data: {
        name: tile.name,
        geometry: tile.geometry as unknown as object,
        ...calculateBoundingBox(tile.geometry),
        source: 'MAPBOX',
        spatialKey: key,
      },
      select: { id: true },
    });
    idByKey.set(key, created.id);
  }
  console.log(`\nTile rows: ${idByKey.size}`);

  // 2. Move every reference off the old rows, then remove them. Deletes cascade,
  //    so this order is the difference between a migration and a data loss.
  const keepIds = new Set<string>();
  for (const rows of collisions) {
    const nearest = rows.reduce((best, row) => (row.distance < best.distance ? row : best));
    keepIds.add(nearest.id);
  }
  const dropIds = collisions.flatMap((rows) => rows.filter((row) => !keepIds.has(row.id)).map((row) => row.id));

  const eventTarget = new Map<string, string>();
  const matchTargetBySample = new Map<string, string>();
  for (const match of matches) {
    const key = targetKeyByMatch.get(match.id);
    const id = key ? idByKey.get(key) : undefined;
    if (id) matchTargetBySample.set(match.gpsId, id);
  }
  for (const event of events) {
    const id = event.startGpsId ? matchTargetBySample.get(event.startGpsId) : undefined;
    // An event whose first sample lost its match still has to go somewhere, or
    // the cascade takes it. The longest tile of its old road is the closest
    // thing to where it was.
    const fallback = idByKey.get(longestTileKeyForRoad(nameById.get(event.segmentId) ?? '', tiles) ?? '');
    const target = id ?? fallback;
    if (target) eventTarget.set(event.id, target);
  }

  // Grouped by destination: one statement per target segment rather than one
  // per row. 23k individual updates over the network would not finish inside
  // any sane transaction timeout.
  const dropSet = new Set(dropIds);
  const matchIdsBySegment = new Map<string, string[]>();
  for (const match of matches) {
    if (dropSet.has(match.id)) continue;
    const key = targetKeyByMatch.get(match.id);
    const segmentId = key ? idByKey.get(key) : undefined;
    if (!segmentId) continue;
    const bucket = matchIdsBySegment.get(segmentId);
    if (bucket) bucket.push(match.id);
    else matchIdsBySegment.set(segmentId, [match.id]);
  }
  const eventIdsBySegment = new Map<string, string[]>();
  for (const [id, segmentId] of eventTarget) {
    const bucket = eventIdsBySegment.get(segmentId);
    if (bucket) bucket.push(id);
    else eventIdsBySegment.set(segmentId, [id]);
  }

  await prisma.$transaction(async (tx) => {
    if (dropIds.length) await tx.gpsSegmentMatch.deleteMany({ where: { id: { in: dropIds } } });
    for (const [segmentId, ids] of eventIdsBySegment) {
      await tx.congestionEvent.updateMany({ where: { id: { in: ids } }, data: { segmentId } });
    }
    for (const [segmentId, ids] of matchIdsBySegment) {
      // Chunked so a single statement never carries an unbounded id list.
      for (let start = 0; start < ids.length; start += 1_000) {
        await tx.gpsSegmentMatch.updateMany({
          where: { id: { in: ids.slice(start, start + 1_000) } },
          data: { segmentId },
        });
      }
    }
    await tx.roadSegment.deleteMany({ where: { id: { in: Array.from(doomed) } } });
  }, { timeout: 300_000, maxWait: 30_000 });

  const eventsAfter = await prisma.congestionEvent.count();
  const durationAfter = (await prisma.congestionEvent.aggregate({ _sum: { duration: true } }))._sum.duration;
  const segmentsAfter = await prisma.roadSegment.count({ where: { source: 'MAPBOX' } });

  console.log('\nApplied.');
  console.log(`  segments: ${segments.length} -> ${segmentsAfter}`);
  console.log(`  congestion events: ${eventsBefore} -> ${eventsAfter}` +
    (eventsBefore === eventsAfter ? '  (conserved)' : '  *** NOT CONSERVED ***'));
  console.log(`  congestion duration: ${durationBefore} -> ${durationAfter}` +
    (durationBefore === durationAfter ? '  (conserved)' : '  *** NOT CONSERVED ***'));
  console.log('\nNow rebuild the aggregates, which are keyed on segmentId:');
  console.log('  npm run rebuild-segment-stats -- --apply');
}

/** Nearest tile of the same road to a position, for samples no tile contains. */
function nearestTileKey(
  name: string,
  position: GeoJSON.Position,
  tiles: Map<string, SegmentTile & { name: string }>
): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [key, tile] of tiles) {
    if (tile.name !== name || tile.geometry.coordinates.length < 2) continue;
    const distance = Number(turf.nearestPointOnLine(
      turf.lineString(tile.geometry.coordinates),
      turf.point(position),
      { units: 'meters' }
    ).properties.dist ?? Number.POSITIVE_INFINITY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return best;
}

function longestTileKeyForRoad(
  name: string,
  tiles: Map<string, SegmentTile & { name: string }>
): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const [key, tile] of tiles) {
    if (tile.name !== name) continue;
    const length = lengthMeters(tile.geometry);
    if (length > bestLength) {
      bestLength = length;
      best = key;
    }
  }
  return best;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
