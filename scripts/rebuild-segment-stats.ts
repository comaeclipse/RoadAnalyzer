/**
 * Rebuild Segment Statistics
 *
 * SegmentStatistics is a pre-aggregated (materialized view) table that the live
 * pipeline maintains incrementally: `eventCount` and `totalDuration` are written
 * with `increment`, so they only ever grow. Nothing subtracts. That means:
 *
 *   - Deleting drives leaves their contributions permanently baked into the totals.
 *   - The percentage/score columns are overwritten by whichever drive last touched
 *     a segment, so they describe one drive while eventCount describes all of them.
 *
 * This script discards the table and recomputes every row from the CongestionEvent
 * rows that actually exist, using the same aggregation function the live pipeline
 * uses (`aggregateSegmentStatistics`), so the results agree by construction.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npm run rebuild-segment-stats            # preview the diff, change nothing
 *   npm run rebuild-segment-stats -- --apply # rebuild the table
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import { prisma } from '../lib/prisma';
import {
  aggregateSegmentStatistics,
  type SegmentStatsAggregate,
  type SegmentStatsEvent,
} from '../lib/post-processing';

const APPLY = process.argv.includes('--apply');

/** Stable identity for a statistics row, so old and new rows can be paired up. */
function windowKey(row: {
  segmentId: string;
  dayOfWeek: number | null;
  hourOfDay: number | null;
  weekStart: Date | null;
}): string {
  return [
    row.segmentId,
    row.dayOfWeek ?? 'all',
    row.hourOfDay ?? 'all',
    row.weekStart ? row.weekStart.toISOString() : 'all',
  ].join(':');
}

function describeWindow(row: SegmentStatsAggregate, segmentName: string): string {
  const parts: string[] = [];
  if (row.dayOfWeek !== null) {
    parts.push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][row.dayOfWeek]);
  }
  if (row.hourOfDay !== null) parts.push(`${String(row.hourOfDay).padStart(2, '0')}:00`);
  if (row.weekStart !== null) parts.push(`week of ${row.weekStart.toISOString().slice(0, 10)}`);
  return `${segmentName} [${parts.length ? parts.join(' ') : 'all-time'}]`;
}

async function rebuildSegmentStatistics() {
  console.log('🔄 Rebuilding segment statistics from congestion events\n');
  console.log(APPLY ? '⚠️  MODE: APPLY (will write)\n' : '🔍 MODE: DRY RUN (no changes)\n');

  // Source of truth: every congestion event still in the database. Events cascade
  // with their drive, so anything here belongs to a drive that still exists.
  const events = await prisma.congestionEvent.findMany({
    select: {
      segmentId: true,
      dayOfWeek: true,
      hourOfDay: true,
      startTime: true,
      duration: true,
      avgSpeed: true,
      severity: true,
    },
  });

  const existing = await prisma.segmentStatistics.findMany();

  console.log(`Congestion events found:      ${events.length}`);
  console.log(`SegmentStatistics rows now:   ${existing.length}`);

  if (events.length === 0 && existing.length > 0) {
    console.log(
      '\n⚠️  No congestion events remain, so every statistics row is orphaned.'
    );
  }

  const rebuilt = aggregateSegmentStatistics(events as SegmentStatsEvent[]);
  console.log(`SegmentStatistics rows after: ${rebuilt.length}\n`);

  // Resolve segment names for readable output
  const segmentIds = Array.from(
    new Set([...rebuilt.map((r) => r.segmentId), ...existing.map((r) => r.segmentId)])
  );
  const segments = await prisma.roadSegment.findMany({
    where: { id: { in: segmentIds } },
    select: { id: true, name: true },
  });
  const segmentNames = new Map(segments.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => segmentNames.get(id) ?? id;

  // Pair old and new rows by window to show what actually changes
  const oldByKey = new Map(existing.map((row) => [windowKey(row), row]));
  const newByKey = new Map(rebuilt.map((row) => [windowKey(row), row]));

  const added: SegmentStatsAggregate[] = [];
  const changed: Array<{ row: SegmentStatsAggregate; oldEvents: number; oldDuration: number }> = [];
  const unchanged: SegmentStatsAggregate[] = [];

  for (const [key, row] of Array.from(newByKey.entries())) {
    const prior = oldByKey.get(key);
    if (!prior) {
      added.push(row);
    } else if (
      prior.eventCount !== row.eventCount ||
      prior.totalDuration !== row.totalDuration
    ) {
      changed.push({ row, oldEvents: prior.eventCount, oldDuration: prior.totalDuration });
    } else {
      unchanged.push(row);
    }
  }
  const removed = existing.filter((row) => !newByKey.has(windowKey(row)));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 DIFF');
  console.log(`   Removed (no events left):  ${removed.length}`);
  console.log(`   Corrected (stale totals):  ${changed.length}`);
  console.log(`   Added (missing window):    ${added.length}`);
  console.log(`   Unchanged:                 ${unchanged.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (removed.length > 0) {
    console.log('🗑️  Removed rows:');
    for (const row of removed.slice(0, 25)) {
      console.log(
        `   ${describeWindow(row as unknown as SegmentStatsAggregate, nameOf(row.segmentId))}` +
          ` — was ${row.eventCount} events / ${(row.totalDuration / 1000).toFixed(0)}s`
      );
    }
    if (removed.length > 25) console.log(`   ... and ${removed.length - 25} more`);
    console.log('');
  }

  if (changed.length > 0) {
    console.log('✏️  Corrected rows:');
    for (const { row, oldEvents, oldDuration } of changed.slice(0, 25)) {
      console.log(
        `   ${describeWindow(row, nameOf(row.segmentId))}` +
          ` — events ${oldEvents} → ${row.eventCount},` +
          ` duration ${(oldDuration / 1000).toFixed(0)}s → ${(row.totalDuration / 1000).toFixed(0)}s`
      );
    }
    if (changed.length > 25) console.log(`   ... and ${changed.length - 25} more`);
    console.log('');
  }

  if (added.length > 0) {
    console.log('➕ Added rows:');
    for (const row of added.slice(0, 25)) {
      console.log(
        `   ${describeWindow(row, nameOf(row.segmentId))}` +
          ` — ${row.eventCount} events / ${(row.totalDuration / 1000).toFixed(0)}s`
      );
    }
    if (added.length > 25) console.log(`   ... and ${added.length - 25} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log('🔍 Dry run complete — nothing was written.');
    console.log('   Re-run with --apply to rebuild:');
    console.log('   npm run rebuild-segment-stats -- --apply');
    return;
  }

  if (removed.length === 0 && changed.length === 0 && added.length === 0) {
    console.log('✅ Already consistent — nothing to write.');
    return;
  }

  // Replace wholesale inside one transaction: a partial rebuild would leave the
  // table in a worse state than either the old or the new version.
  //
  // sampleCount is intentionally left at 0. The live pipeline never populates it
  // either, and it counts GPS samples rather than congestion events, so there is
  // no honest value to derive from CongestionEvent rows alone.
  await prisma.$transaction([
    prisma.segmentStatistics.deleteMany({}),
    prisma.segmentStatistics.createMany({
      data: rebuilt.map((row) => ({
        segmentId: row.segmentId,
        dayOfWeek: row.dayOfWeek,
        hourOfDay: row.hourOfDay,
        weekStart: row.weekStart,
        sampleCount: 0,
        eventCount: row.eventCount,
        totalDuration: row.totalDuration,
        avgSpeed: row.avgSpeed,
        avgCongestionSpeed: row.avgSpeed,
        pctFreeFlow: row.pctFreeFlow,
        pctSlow: row.pctSlow,
        pctCongested: row.pctCongested,
        pctHeavy: row.pctHeavy,
        pctGridlock: row.pctGridlock,
        congestionScore: row.congestionScore,
      })),
    }),
  ]);

  const finalCount = await prisma.segmentStatistics.count();
  console.log(`✅ Rebuilt. SegmentStatistics now has ${finalCount} rows.`);

  if (finalCount !== rebuilt.length) {
    throw new Error(
      `Verification failed: expected ${rebuilt.length} rows, found ${finalCount}.`
    );
  }
  console.log('✅ Row count verified.');
}

rebuildSegmentStatistics()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
