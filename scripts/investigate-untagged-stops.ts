import './load-env';
import { prisma } from '../lib/prisma';
import {
  detectStops,
  haversineMeters,
  bearingDelta,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
  type AnalysisPoint,
} from '../lib/intersection-stops';

// Local day window in the driver's timezone. Drives are stored in UTC; the
// user asked for "yesterday and today", so build the window from local dates.
function dayStart(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const from = dayStart(1); // start of yesterday, local
const to = new Date(); // now

const KIND_LABEL: Record<string, string> = {
  RED_LIGHT: 'Red light',
  STOP_SIGN: 'Stop sign',
  SLOWDOWN: 'Slowdown',
};

function fmt(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { hour12: true });
}

async function main() {
  const drives = await prisma.drive.findMany({
    where: {
      source: 'IOS',
      startTime: { gte: from, lte: to },
    },
    orderBy: { startTime: 'asc' },
    include: {
      gpsData: { orderBy: { timestamp: 'asc' } },
      trafficTags: true,
      pausedIntervals: true,
    },
  });

  console.log(`Window: ${from.toLocaleString()} → ${to.toLocaleString()}`);
  console.log(`iOS drives in window: ${drives.length}\n`);

  const opts = DEFAULT_OPTIONS;

  for (const drive of drives) {
    const points: AnalysisPoint[] = drive.gpsData.map((g) => ({
      lat: g.latitude,
      lng: g.longitude,
      speed: g.speed,
      timestamp: Number(g.timestamp),
    }));

    const analysisDrive: AnalysisDrive = {
      id: drive.id,
      name: drive.name,
      startTime: drive.startTime.toISOString(),
      points,
    };

    const stops = detectStops(analysisDrive, opts);
    const tags = drive.trafficTags.map((t) => ({
      lat: t.latitude,
      lng: t.longitude,
      kind: t.kind,
      startTime: t.startTime.getTime(),
      endTime: t.endTime.getTime(),
      duration: t.duration,
    }));

    // Match each detected stop to a tag: same place (<= clusterRadius) AND
    // overlapping in time (the tag's stationary window covers the stop's start).
    // A stop with no such tag is one that was recorded on the trace but never
    // labelled — the phone either never prompted, or the prompt was dismissed.
    const TIME_SLOP = 20_000; // ms; a tag whose window is near the stop in time
    const untagged: typeof stops = [];
    for (const stop of stops) {
      const matched = tags.some((tag) => {
        const near = haversineMeters(stop, tag) <= opts.clusterRadius;
        const timeClose =
          stop.timestamp >= tag.startTime - TIME_SLOP &&
          stop.timestamp <= tag.endTime + TIME_SLOP;
        return near && timeClose;
      });
      if (!matched) untagged.push(stop);
    }

    const durMin = (drive.duration ?? 0) / 60000;
    console.log('─'.repeat(78));
    console.log(
      `DRIVE ${drive.id}  "${drive.name ?? '(unnamed)'}"  ${drive.status}`
    );
    console.log(
      `  start ${drive.startTime.toLocaleString()}  ~${durMin.toFixed(0)} min  ` +
        `${drive.gpsData.length} gps  ${drive.pausedIntervals.length} pauses`
    );
    console.log(
      `  detected stops (>=2s stationary): ${stops.length}   ` +
        `tags saved: ${tags.length}   UNTAGGED STOPS: ${untagged.length}`
    );

    if (tags.length) {
      console.log('  tags:');
      for (const t of [...tags].sort((a, b) => a.startTime - b.startTime)) {
        console.log(
          `    • ${KIND_LABEL[t.kind] ?? t.kind}  ${(t.duration / 1000).toFixed(1)}s  ` +
            `@ ${fmt(t.startTime)}  (${t.lat.toFixed(5)},${t.lng.toFixed(5)})`
        );
      }
    }

    if (untagged.length) {
      console.log('  >>> STOPS WITH NO TAG:');
      // For each untagged stop, measure gap to the previous stop of the drive —
      // a small gap is the fingerprint of the suspected cooldown-suppression bug.
      const allByTime = [...stops].sort((a, b) => a.timestamp - b.timestamp);
      for (const stop of untagged) {
        const idx = allByTime.findIndex((s) => s.timestamp === stop.timestamp);
        const prev = idx > 0 ? allByTime[idx - 1] : null;
        const gapS = prev ? (stop.timestamp - (prev.timestamp + prev.duration)) / 1000 : null;
        const distPrev = prev ? haversineMeters(stop, prev) : null;
        console.log(
          `    • ${fmt(stop.timestamp)}  stationary ${(stop.duration / 1000).toFixed(1)}s  ` +
            `(${stop.lat.toFixed(5)},${stop.lng.toFixed(5)})  brg ${stop.bearing.toFixed(0)}°`
        );
        if (prev) {
          console.log(
            `        ↑ ${gapS!.toFixed(0)}s and ${distPrev!.toFixed(0)}m after previous stop ` +
              `(${fmt(prev.timestamp)}, ${(prev.duration / 1000).toFixed(1)}s)` +
              (gapS! <= 45 ? '   <-- within 45s rearm cooldown' : '')
          );
        }
      }
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
