import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// GET /api/routes - List reusable route templates with their run history
export async function GET() {
  try {
    const templates = await prisma.routeTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        drives: {
          orderBy: { startTime: 'desc' },
          select: {
            id: true,
            name: true,
            startTime: true,
            duration: true,
            distance: true,
            avgSpeed: true,
            maxSpeed: true,
            source: true,
            _count: { select: { congestionEvents: true, trafficTags: true } },
          },
        },
      },
    });

    const routes = templates.map((template) => {
      const runs = template.drives.map((drive) => ({
        id: drive.id,
        name: drive.name,
        startTime: drive.startTime,
        duration: drive.duration,
        distance: drive.distance,
        avgSpeed: drive.avgSpeed,
        maxSpeed: drive.maxSpeed,
        source: drive.source,
        congestionEvents: drive._count.congestionEvents,
        trafficTags: drive._count.trafficTags,
        // The drive this template was created from. Its geometry *is* the template.
        isReference: drive.id === template.referenceDriveId,
      }));

      const durations = runs
        .map((run) => run.duration)
        .filter((duration): duration is number => duration !== null)
        .sort((a, b) => a - b);

      const fastest = durations.length > 0 ? durations[0] : null;
      const slowest = durations.length > 0 ? durations[durations.length - 1] : null;

      return {
        id: template.id,
        name: template.name,
        distance: template.distance,
        direction: template.direction,
        isActive: template.isActive,
        createdAt: template.createdAt,
        referenceDriveId: template.referenceDriveId,
        geometry: template.geometry as unknown as GeoJSON.LineString,
        stats: {
          runCount: runs.length,
          fastestDuration: fastest,
          slowestDuration: slowest,
          medianDuration: median(durations),
          avgDuration: mean(durations),
          // Spread between best and worst run: how much this route varies day to day.
          durationSpread: fastest !== null && slowest !== null ? slowest - fastest : null,
          avgSpeed: mean(
            runs
              .map((run) => run.avgSpeed)
              .filter((speed): speed is number => speed !== null)
          ),
          avgCongestionEvents: mean(runs.map((run) => run.congestionEvents)),
          lastRunAt: runs.length > 0 ? runs[0].startTime : null,
          fastestRunId:
            fastest === null
              ? null
              : runs.find((run) => run.duration === fastest)?.id ?? null,
        },
        runs,
      };
    });

    return NextResponse.json({ routes });
  } catch (error) {
    console.error('Failed to fetch routes:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}
