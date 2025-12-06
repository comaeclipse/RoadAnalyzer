import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { HeatmapResponse } from '@/types/congestion';

// GET /api/congestion/heatmap - Get heatmap data for all segments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dayOfWeekParam = searchParams.get('dayOfWeek');
    const hourOfDayParam = searchParams.get('hourOfDay');

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
    const stats = await prisma.segmentStatistics.findMany({
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
    });

    // Format for heatmap visualization
    const heatmapData: HeatmapResponse = {
      heatmap: stats.map(stat => ({
        segmentId: stat.segmentId,
        name: stat.segment.name,
        geometry: stat.segment.geometry as GeoJSON.LineString,
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
      })),
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
