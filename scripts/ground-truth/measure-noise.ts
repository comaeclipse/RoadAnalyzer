/**
 * Measure what a phone's GPS trace actually looks like, so synthetic traces can
 * be degraded to match.
 *
 * A generated trajectory is too clean: perfectly spaced samples, exact speeds,
 * no dropouts. Tests built on clean traces pass while real data fails, which is
 * worse than no tests at all. The numbers this prints are the ones baked into
 * lib/ground-truth.ts, and re-running it after a recorder change says whether
 * they still hold.
 *
 *   npx tsx scripts/ground-truth/measure-noise.ts
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import '../load-env';

import { prisma } from '../../lib/prisma';

const percentile = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : NaN;

async function main() {
  const drives = await prisma.drive.findMany({
    where: { status: 'COMPLETED', recordingMode: 'TRAFFIC' },
    orderBy: { startTime: 'desc' },
    take: 10,
    select: { id: true },
  });

  const intervals: number[] = [];
  const accuracies: number[] = [];
  let samples = 0;
  let nullSpeeds = 0;
  const stoppedSpeeds: number[] = [];

  for (const drive of drives) {
    const rows = await prisma.gpsSample.findMany({
      where: { driveId: drive.id },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, speed: true, accuracy: true },
    });
    for (let index = 0; index < rows.length; index++) {
      samples++;
      const row = rows[index];
      if (row.speed == null || row.speed < 0) nullSpeeds++;
      // Speeds reported while essentially stationary: the floor of the sensor,
      // which decides whether a stopped car reads as stopped.
      if (row.speed != null && row.speed >= 0 && row.speed < 1) stoppedSpeeds.push(row.speed);
      if (row.accuracy != null) accuracies.push(row.accuracy);
      if (index > 0) intervals.push(Number(rows[index].timestamp - rows[index - 1].timestamp));
    }
  }

  intervals.sort((a, b) => a - b);
  accuracies.sort((a, b) => a - b);
  stoppedSpeeds.sort((a, b) => a - b);

  console.log(`drives sampled: ${drives.length}, gps samples: ${samples}`);
  console.log(`sample interval ms: p05 ${percentile(intervals, 0.05)} median ${percentile(intervals, 0.5)} ` +
    `p95 ${percentile(intervals, 0.95)} p99 ${percentile(intervals, 0.99)} max ${intervals[intervals.length - 1]}`);
  console.log(`gaps over 5 s: ${intervals.filter((value) => value > 5_000).length}`);
  console.log(`accuracy m: min ${accuracies[0]} p50 ${percentile(accuracies, 0.5)} ` +
    `p90 ${percentile(accuracies, 0.9)} max ${accuracies[accuracies.length - 1]}`);
  console.log(`missing or negative speed: ${nullSpeeds} of ${samples} (${(100 * nullSpeeds / samples).toFixed(2)}%)`);
  console.log(`speed while under 1 m/s: p50 ${percentile(stoppedSpeeds, 0.5)?.toFixed(3)} ` +
    `p90 ${percentile(stoppedSpeeds, 0.9)?.toFixed(3)} max ${stoppedSpeeds[stoppedSpeeds.length - 1]?.toFixed(3)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
