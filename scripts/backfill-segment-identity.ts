/**
 * Backfill stable segment identity.
 *
 * RoadSegment rows are keyed on Mapbox's OpenLR sourceId, which changes between
 * matches of the same road, so one physical stretch accumulates a row per drive.
 * lib/segment-identity.ts computes a deterministic key instead; this script
 * writes that key onto existing rows and collapses the duplicates it reveals.
 *
 * Order matters. Deleting a RoadSegment cascades to its CongestionEvent and
 * GpsSegmentMatch rows, so everything is repointed at the canonical row before
 * anything is deleted. GpsSegmentMatch is unique on (gpsId, segmentId): a sample
 * matched to two rows of the same stretch becomes two rows with one id after
 * repointing, so the nearest match is kept and the rest dropped.
 *
 * Idempotent: a second run reports nothing to do.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-segment-identity.ts             # report only
 *   npx tsx scripts/backfill-segment-identity.ts --apply     # collapse them
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
import { spatialKeyFor } from '../lib/segment-identity';

const APPLY = process.argv.includes('--apply');

interface SegmentRow {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  createdAt: Date;
}

function lengthMeters(geometry: GeoJSON.LineString): number {
  if (!geometry?.coordinates || geometry.coordinates.length < 2) return 0;
  return turf.length(turf.lineString(geometry.coordinates), { units: 'meters' });
}

/**
 * Mean distance from each vertex of `a` to the nearest point on `b`, the same
 * measure lib/segment-dedupe.ts uses to decide two rows are the same stretch.
 * Used here only to cross-check the key: the two mechanisms should broadly
 * agree, and where they do not, one of them is wrong.
 */
function meanVertexDistance(a: GeoJSON.LineString, b: GeoJSON.LineString): number {
  const line = turf.lineString(b.coordinates);
  let sum = 0;
  for (const coordinate of a.coordinates) {
    const snapped = turf.nearestPointOnLine(line, turf.point(coordinate), { units: 'meters' });
    sum += Number(snapped.properties.dist ?? 0);
  }
  return sum / a.coordinates.length;
}

function coincident(a: GeoJSON.LineString, b: GeoJSON.LineString): boolean {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return false;
  return Math.min(meanVertexDistance(a, b), meanVertexDistance(b, a)) < 15;
}

async function main() {
  const segments = (await prisma.roadSegment.findMany({
    where: { source: 'MAPBOX' },
    // spatialKey is deliberately not selected: the dry run has to be runnable
    // before the column exists, so the numbers can be reviewed before anything
    // is migrated.
    select: { id: true, name: true, geometry: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })) as unknown as SegmentRow[];

  console.log(`MAPBOX road segments: ${segments.length}`);

  const keyed = new Map<string, SegmentRow[]>();
  const unkeyable: SegmentRow[] = [];
  for (const segment of segments) {
    const key = spatialKeyFor({ name: segment.name, geometry: segment.geometry });
    if (!key) {
      unkeyable.push(segment);
      continue;
    }
    const bucket = keyed.get(key);
    if (bucket) bucket.push(segment);
    else keyed.set(key, [segment]);
  }

  console.log(`  distinct spatial keys: ${keyed.size}`);
  console.log(`  rows the key declines to identify (kept as-is): ${unkeyable.length}`);

  const clusters = Array.from(keyed.entries())
    .filter(([, rows]) => rows.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  const collapsing = clusters.reduce((total, [, rows]) => total + rows.length - 1, 0);
  console.log(`  duplicate clusters: ${clusters.length}, rows they collapse: ${collapsing}`);
  console.log(`  segments after collapse: ${segments.length - collapsing}`);

  // Canonical is the longest geometry: it is the row that best represents the
  // stretch, and it is what the read-layer dedupe already picks.
  const canonicalOf = new Map<string, SegmentRow>();
  const repointFrom = new Map<string, string>();
  for (const [key, rows] of keyed) {
    const canonical = rows.reduce((best, row) =>
      lengthMeters(row.geometry) > lengthMeters(best.geometry) ? row : best);
    canonicalOf.set(key, canonical);
    for (const row of rows) if (row.id !== canonical.id) repointFrom.set(row.id, canonical.id);
  }

  console.log('\nLargest clusters:');
  for (const [key, rows] of clusters.slice(0, 12)) {
    const canonical = canonicalOf.get(key)!;
    // A cluster whose members do not lie on top of each other is a warning that
    // the key merged two different roads, which is the failure this dry run
    // exists to catch.
    const disagreeing = rows.filter((row) => row.id !== canonical.id &&
      !coincident(row.geometry, canonical.geometry)).length;
    console.log(`  ${rows.length} rows  ${Math.round(lengthMeters(canonical.geometry))} m  ${canonical.name}` +
      (disagreeing ? `   *** ${disagreeing} not coincident with canonical ***` : ''));
  }

  const doomed = Array.from(repointFrom.keys());
  if (doomed.length === 0) {
    console.log('\nNothing to collapse.');
  }

  // What the repointing has to move, and where it collides.
  const events = await prisma.congestionEvent.count({ where: { segmentId: { in: doomed } } });
  const matches = await prisma.gpsSegmentMatch.findMany({
    where: { segmentId: { in: doomed } },
    select: { id: true, gpsId: true, segmentId: true, distance: true },
  });
  const survivors = await prisma.gpsSegmentMatch.findMany({
    where: { segmentId: { in: Array.from(new Set(repointFrom.values())) } },
    select: { id: true, gpsId: true, segmentId: true, distance: true },
  });

  // Group every match that will end up on a canonical row by (gpsId, canonical),
  // which is the unique constraint. Anything but the nearest row has to go.
  const byTarget = new Map<string, { id: string; distance: number }[]>();
  for (const match of [...matches, ...survivors]) {
    const target = repointFrom.get(match.segmentId) ?? match.segmentId;
    const composite = `${match.gpsId}:${target}`;
    const bucket = byTarget.get(composite);
    const entry = { id: match.id, distance: match.distance };
    if (bucket) bucket.push(entry);
    else byTarget.set(composite, [entry]);
  }
  const collisions = Array.from(byTarget.values()).filter((rows) => rows.length > 1);
  const droppedMatches = collisions.reduce((total, rows) => total + rows.length - 1, 0);

  console.log(`\nCongestionEvent rows to repoint: ${events}`);
  console.log(`GpsSegmentMatch rows to repoint: ${matches.length}`);
  console.log(`GpsSegmentMatch rows dropped as duplicates: ${droppedMatches}`);

  const eventsBefore = await prisma.congestionEvent.count();
  const durationBefore = await prisma.congestionEvent.aggregate({ _sum: { duration: true } });

  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    console.log('Re-run with --apply to collapse:');
    console.log('  npx tsx scripts/backfill-segment-identity.ts --apply');
    return;
  }

  // Order is load-bearing: deleting a segment cascades to its events and
  // matches, so both are moved off the doomed rows first.
  const keepById = new Map<string, string>();
  for (const rows of collisions) {
    const nearest = rows.reduce((best, row) => (row.distance < best.distance ? row : best));
    for (const row of rows) if (row.id !== nearest.id) keepById.set(row.id, nearest.id);
  }
  const dropIds = Array.from(keepById.keys());

  await prisma.$transaction(async (tx) => {
    if (dropIds.length) {
      await tx.gpsSegmentMatch.deleteMany({ where: { id: { in: dropIds } } });
    }
    for (const [from, to] of repointFrom) {
      await tx.congestionEvent.updateMany({ where: { segmentId: from }, data: { segmentId: to } });
      await tx.gpsSegmentMatch.updateMany({ where: { segmentId: from }, data: { segmentId: to } });
    }
    // Write the key onto every row that survives, canonical or untouched.
    for (const [key, canonical] of canonicalOf) {
      await tx.roadSegment.update({ where: { id: canonical.id }, data: { spatialKey: key } });
    }
    if (doomed.length) {
      await tx.roadSegment.deleteMany({ where: { id: { in: doomed } } });
    }
  }, { timeout: 120_000 });

  const eventsAfter = await prisma.congestionEvent.count();
  const durationAfter = await prisma.congestionEvent.aggregate({ _sum: { duration: true } });
  const segmentsAfter = await prisma.roadSegment.count({ where: { source: 'MAPBOX' } });
  const orphans = await prisma.gpsSegmentMatch.count({ where: { segmentId: { in: doomed } } });

  console.log('\nApplied.');
  console.log(`  segments: ${segments.length} -> ${segmentsAfter}`);
  console.log(`  congestion events: ${eventsBefore} -> ${eventsAfter}` +
    (eventsBefore === eventsAfter ? '  (conserved)' : '  *** NOT CONSERVED ***'));
  console.log(`  congestion duration: ${durationBefore._sum.duration} -> ${durationAfter._sum.duration}` +
    (durationBefore._sum.duration === durationAfter._sum.duration ? '  (conserved)' : '  *** NOT CONSERVED ***'));
  console.log(`  matches still pointing at a deleted segment: ${orphans}`);
  console.log('\nNow rebuild the aggregates, which are keyed on segmentId:');
  console.log('  npm run rebuild-segment-stats -- --apply');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
