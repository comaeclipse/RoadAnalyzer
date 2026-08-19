/**
 * Re-detect congestion events across every drive.
 *
 * detectCongestion ends an event when the segment changes, so what counts as
 * one event depends on what a segment is. Segments used to be whatever extent
 * Mapbox matched on a given drive; they are now fixed tiles of a road. Events
 * stored before that change were repointed onto tiles rather than re-detected,
 * so a jam that spans two tiles is one event in the back catalogue and two in
 * anything analysed since. This re-runs detection over the stored GPS matches
 * so the whole history agrees.
 *
 * Detection is a pure function of samples that are not touched here, so this is
 * re-runnable: the same input gives the same events every time.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/redetect-congestion.ts             # report the diff
 *   npx tsx scripts/redetect-congestion.ts --apply     # rewrite the events
 *
 * After --apply, rebuild the aggregates. updateSegmentStatistics only ever
 * increments, so it cannot follow a rewrite:
 *
 *   npx tsx scripts/rebuild-segment-stats.ts --apply
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import { prisma } from '../lib/prisma';
import { detectCongestion } from '../lib/congestion-detection';
import { roadOfKey } from '../lib/segment-identity';

const APPLY = process.argv.includes('--apply');

const seconds = (milliseconds: number) => `${Math.round(milliseconds / 1000)}s`;

async function main() {
  const drives = await prisma.drive.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { startTime: 'asc' },
    select: { id: true, name: true, startTime: true },
  });

  let oldTotal = 0;
  let newTotal = 0;
  let oldDuration = 0;
  let newDuration = 0;
  const changed: { label: string; from: number; to: number; fromMs: number; toMs: number }[] = [];
  const pending = new Map<string, ReturnType<typeof detectCongestion>>();

  for (const drive of drives) {
    const samples = await prisma.gpsSample.findMany({
      where: { driveId: drive.id },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        driveId: true,
        timestamp: true,
        speed: true,
        distanceFromPrev: true,
        segmentMatches: { take: 1, select: { segmentId: true, segment: { select: { spatialKey: true } } } },
      },
    });
    const existing = await prisma.congestionEvent.findMany({
      where: { driveId: drive.id },
      select: { duration: true },
    });

    const events = detectCongestion(samples.map(({ segmentMatches, ...gps }) => ({
      ...gps,
      segmentId: segmentMatches[0]?.segmentId,
      roadId: roadOfKey(segmentMatches[0]?.segment.spatialKey) ?? segmentMatches[0]?.segmentId,
    })));

    pending.set(drive.id, events);

    const existingDuration = existing.reduce((total, event) => total + event.duration, 0);
    const eventsDuration = events.reduce((total, event) => total + event.duration, 0);
    oldTotal += existing.length;
    newTotal += events.length;
    oldDuration += existingDuration;
    newDuration += eventsDuration;

    if (existing.length !== events.length || existingDuration !== eventsDuration) {
      changed.push({
        label: `${drive.startTime.toISOString().slice(0, 16).replace('T', ' ')} ${drive.id.slice(0, 8)}`,
        from: existing.length,
        to: events.length,
        fromMs: existingDuration,
        toMs: eventsDuration,
      });
    }
  }

  console.log(`drives: ${drives.length}`);
  console.log(`events: ${oldTotal} -> ${newTotal}`);
  console.log(`total congestion time: ${seconds(oldDuration)} -> ${seconds(newDuration)}`);
  console.log(`drives whose events change: ${changed.length}`);

  // Time is the invariant worth watching, not the count. Splitting one event at
  // a tile boundary should produce two events covering the same span; a large
  // swing in total time means detection is seeing different ground, not just
  // cutting it differently.
  const drift = oldDuration === 0 ? 0 : Math.abs(newDuration - oldDuration) / oldDuration;
  console.log(`congestion time drift: ${(drift * 100).toFixed(1)}%`);

  for (const entry of changed.slice(0, 15)) {
    console.log(`  ${entry.label}  ${entry.from} -> ${entry.to} events, ${seconds(entry.fromMs)} -> ${seconds(entry.toMs)}`);
  }
  if (changed.length > 15) console.log(`  ... and ${changed.length - 15} more`);

  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    console.log('Re-run with --apply to rewrite:');
    console.log('  npx tsx scripts/redetect-congestion.ts --apply');
    return;
  }

  for (const [driveId, events] of pending) {
    await prisma.$transaction([
      prisma.congestionEvent.deleteMany({ where: { driveId } }),
      prisma.congestionEvent.createMany({ data: events }),
    ]);
  }

  const after = await prisma.congestionEvent.count();
  const afterDuration = (await prisma.congestionEvent.aggregate({ _sum: { duration: true } }))._sum.duration ?? 0;
  console.log('\nApplied.');
  console.log(`  events: ${after}` + (after === newTotal ? '  (as predicted)' : `  *** expected ${newTotal} ***`));
  console.log(`  total congestion time: ${seconds(afterDuration)}`);
  console.log('\nNow rebuild the aggregates, which only ever increment:');
  console.log('  npx tsx scripts/rebuild-segment-stats.ts --apply');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
