import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { HeatmapResponse } from '@/types/congestion';

export const dynamic = 'force-dynamic';

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

    // Build where clause for filtering
    const where: any = {
      weekStart: null, // Only get overall aggregates, not weekly trends
    };

    // Apply optional filters
    if (dayOfWeekParam !== null) {
      where.dayOfWeek = parseInt(dayOfWeekParam);
    } else {
      where.dayOfWeek = null; // All days
    }

    if (hourOfDayParam !== null) {
      where.hourOfDay = parseInt(hourOfDayParam);
    } else {
      where.hourOfDay = null; // All hours
    }

    // Fetch statistics with segment data
    const [stats, routes, latestDrive] = await Promise.all([
      prisma.segmentStatistics.findMany({
      where,
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
    const segmentHeatmap = stats.map(stat => ({
        segmentId: stat.segmentId,
        name: stat.segment.name,
        geometry: stat.segment.geometry as unknown as GeoJSON.LineString,
        congestionScore: stat.congestionScore,
        eventCount: stat.eventCount,
        avgSpeed: stat.avgSpeed,
        severityBreakdown: {
          freeFlow: stat.pctFreeFlow,
          slow: stat.pctSlow,
          congested: stat.pctCongested,
          heavy: stat.pctHeavy,
          gridlock: stat.pctGridlock,
        },
    }));
    const fallbackRoutes = routes
      .filter((route) => route.gpsData.length >= 2)
      .filter((route) => !severityParam || route.congestionEvents.some((event) => event.severity === severityParam))
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
          eventCount: route.congestionEvents.length,
          avgSpeed: route.avgSpeed,
          severityBreakdown: { freeFlow: 0, slow: 0, congested: 0, heavy: 0, gridlock: 0 },
        };
      });
    const allHeatmap = [...segmentHeatmap, ...fallbackRoutes];
    const speedValues = routes.flatMap((route) => route.gpsData.flatMap((point) => point.speed == null ? [] : [point.speed]));
    const eventCount = routes.reduce((count, route) => count + route.congestionEvents.length, 0);
    const heatmapData: HeatmapResponse & { summary: { driveCount: number; eventCount: number; avgSpeed: number | null; updatedAt: string | null } } = {
      heatmap: allHeatmap,
      summary: {
        driveCount: routes.length,
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
