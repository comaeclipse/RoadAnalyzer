import { NextRequest, NextResponse } from 'next/server';
import { CongestionSeverity, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { HeatmapResponse, HeatmapSegment } from '@/types/congestion';
import { aggregateSegmentStatistics, type SegmentStatsEvent } from '@/lib/post-processing';

export const dynamic = 'force-dynamic';

const SEVERITIES = Object.values(CongestionSeverity) as string[];

/** Events on a drive that match the requested severity, or all of them if none was asked for. */
function eventsMatching<T extends { severity: CongestionSeverity }>(
  events: T[],
  severity: string | null
): T[] {
  return severity ? events.filter((event) => event.severity === severity) : events;
}

function severityBreakdownOf(row: {
  pctFreeFlow: number; pctSlow: number; pctCongested: number; pctHeavy: number; pctGridlock: number;
}): HeatmapSegment['severityBreakdown'] {
  return {
    freeFlow: row.pctFreeFlow,
    slow: row.pctSlow,
    congested: row.pctCongested,
    heavy: row.pctHeavy,
    gridlock: row.pctGridlock,
  };
}

// GET /api/congestion/heatmap - Get heatmap data for all segments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dayOfWeekParam = searchParams.get('dayOfWeek');
    const hourOfDayParam = searchParams.get('hourOfDay');
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const severityParam = searchParams.get('severity');
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) {
      return NextResponse.json({ error: 'Invalid date filter' }, { status: 400 });
    }
    if (severityParam && !SEVERITIES.includes(severityParam)) {
      return NextResponse.json({ error: 'Invalid severity filter' }, { status: 400 });
    }

    // The time window being asked for. null means "across all of them".
    const dayOfWeek = dayOfWeekParam === null ? null : Number(dayOfWeekParam);
    const hourOfDay = hourOfDayParam === null ? null : Number(hourOfDayParam);
    if (dayOfWeek !== null && !Number.isInteger(dayOfWeek)) {
      return NextResponse.json({ error: 'Invalid dayOfWeek filter' }, { status: 400 });
    }
    if (hourOfDay !== null && !Number.isInteger(hourOfDay)) {
      return NextResponse.json({ error: 'Invalid hourOfDay filter' }, { status: 400 });
    }

    // SegmentStatistics is aggregated over all time and every severity, so it
    // cannot answer a date or severity question. When either is asked, aggregate
    // the underlying events instead. Both paths run the same function, so the
    // unfiltered fast path and the filtered live path agree.
    const needsLiveAggregation = Boolean(from || to || severityParam);

    const eventWhere: Prisma.CongestionEventWhereInput = {
      ...(severityParam ? { severity: severityParam as CongestionSeverity } : {}),
      ...(from || to
        ? { startTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    // Fetch statistics with segment data
    const [stats, liveEvents, routes, latestDrive] = await Promise.all([
      needsLiveAggregation
        ? Promise.resolve([])
        : prisma.segmentStatistics.findMany({
            where: { weekStart: null, dayOfWeek, hourOfDay },
            include: {
              segment: {
                select: {
                  id: true,
                  name: true,
                  geometry: true,
                },
              },
            },
          }),
      needsLiveAggregation
        ? prisma.congestionEvent.findMany({
            where: eventWhere,
            select: {
              segmentId: true,
              dayOfWeek: true,
              hourOfDay: true,
              startTime: true,
              duration: true,
              avgSpeed: true,
              severity: true,
              segment: { select: { id: true, name: true, geometry: true } },
            },
          })
        : Promise.resolve([]),
      prisma.drive.findMany({
        where: {
          status: 'COMPLETED',
          recordingMode: 'TRAFFIC',
          ...(from || to ? { startTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        orderBy: { startTime: 'desc' },
        take: 250,
        select: {
          id: true,
          startTime: true,
          avgSpeed: true,
          tripAnalysis: { select: { matchedGeometry: true } },
          gpsData: { orderBy: { timestamp: 'asc' }, select: { latitude: true, longitude: true, speed: true } },
          congestionEvents: { select: { severity: true } },
        },
      }),
      prisma.drive.findFirst({ orderBy: { uploadCompletedAt: 'desc' }, select: { uploadCompletedAt: true, createdAt: true } }),
    ]);

    // Format for heatmap visualization
    let segmentHeatmap: HeatmapSegment[];

    if (needsLiveAggregation) {
      const segments = new Map(
        liveEvents.map((event) => [event.segmentId, event.segment])
      );
      segmentHeatmap = aggregateSegmentStatistics(liveEvents as SegmentStatsEvent[])
        // Keep the same window the pre-aggregated path would have selected.
        .filter((row) =>
          row.weekStart === null && row.dayOfWeek === dayOfWeek && row.hourOfDay === hourOfDay
        )
        .flatMap((row) => {
          const segment = segments.get(row.segmentId);
          if (!segment) return [];
          return [{
            segmentId: row.segmentId,
            name: segment.name,
            geometry: segment.geometry as unknown as GeoJSON.LineString,
            congestionScore: row.congestionScore,
            eventCount: row.eventCount,
            avgSpeed: row.avgSpeed,
            severityBreakdown: severityBreakdownOf(row),
          }];
        });
    } else {
      segmentHeatmap = stats.map((stat) => ({
        segmentId: stat.segmentId,
        name: stat.segment.name,
        geometry: stat.segment.geometry as unknown as GeoJSON.LineString,
        congestionScore: stat.congestionScore,
        eventCount: stat.eventCount,
        avgSpeed: stat.avgSpeed,
        severityBreakdown: severityBreakdownOf(stat),
      }));
    }
    const matchingEvents = (route: { congestionEvents: { severity: CongestionSeverity }[] }) =>
      eventsMatching(route.congestionEvents, severityParam);

    // One filtered set behind both the route layer and the summary tiles, so the
    // headline counts always describe what is actually drawn.
    const visibleRoutes = routes
      .filter((route) => route.gpsData.length >= 2)
      .filter((route) => !severityParam || route.congestionEvents.some((event) => event.severity === severityParam));

    const fallbackRoutes = visibleRoutes
      .map((route) => {
        const score = route.avgSpeed == null ? null : Math.max(0, Math.min(100, (route.avgSpeed / 15) * 100));
        return {
          segmentId: `route-${route.id}`,
          name: 'Anonymous mobile route',
          geometry: {
            type: 'LineString' as const,
            coordinates: (
              route.tripAnalysis?.matchedGeometry as unknown as GeoJSON.LineString | null
            )?.coordinates ?? route.gpsData.map((point) => [point.longitude, point.latitude]),
          },
          congestionScore: score,
          eventCount: matchingEvents(route).length,
          avgSpeed: route.avgSpeed,
          severityBreakdown: { freeFlow: 0, slow: 0, congested: 0, heavy: 0, gridlock: 0 },
        };
      });
    const allHeatmap = [...segmentHeatmap, ...fallbackRoutes];
    const speedValues = visibleRoutes.flatMap((route) => route.gpsData.flatMap((point) => point.speed == null ? [] : [point.speed]));
    const eventCount = visibleRoutes.reduce((count, route) => count + matchingEvents(route).length, 0);
    const heatmapData: HeatmapResponse & { summary: { driveCount: number; eventCount: number; avgSpeed: number | null; updatedAt: string | null } } = {
      heatmap: allHeatmap,
      summary: {
        driveCount: visibleRoutes.length,
        eventCount,
        avgSpeed: speedValues.length ? speedValues.reduce((sum, value) => sum + value, 0) / speedValues.length : null,
        updatedAt: (latestDrive?.uploadCompletedAt ?? latestDrive?.createdAt ?? null)?.toISOString() ?? null,
      },
    };

    return NextResponse.json(heatmapData);
  } catch (error) {
    console.error('Failed to fetch heatmap data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch heatmap data' },
      { status: 500 }
    );
  }
}
