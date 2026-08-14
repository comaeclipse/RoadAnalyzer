import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  analyzeIntersections,
  DEFAULT_OPTIONS,
  type AnalysisDrive,
} from '@/lib/intersection-stops';

export const dynamic = 'force-dynamic';

// GET /api/intersections - Rank recurring stops by approach direction
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minPassesParam = searchParams.get('minPasses');
    const minPasses = minPassesParam === null ? 1 : Number(minPassesParam);
    if (!Number.isInteger(minPasses) || minPasses < 1) {
      return NextResponse.json({ error: 'Invalid minPasses filter' }, { status: 400 });
    }

    const drives = await prisma.drive.findMany({
      where: { status: 'COMPLETED', recordingMode: 'TRAFFIC' },
      orderBy: { startTime: 'desc' },
      select: {
        id: true,
        name: true,
        startTime: true,
        gpsData: {
          orderBy: { timestamp: 'asc' },
          select: {
            latitude: true,
            longitude: true,
            speed: true,
            timestamp: true,
            segmentMatches: {
              take: 1,
              select: { segment: { select: { name: true } } },
            },
          },
        },
        trafficTags: { select: { latitude: true, longitude: true, kind: true } },
      },
    });

    const analysisDrives: AnalysisDrive[] = drives
      .filter((drive) => drive.gpsData.length >= 2)
      .map((drive) => ({
        id: drive.id,
        name: drive.name,
        startTime: drive.startTime.toISOString(),
        points: drive.gpsData.map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
          speed: point.speed,
          timestamp: Number(point.timestamp),
          roadName: point.segmentMatches[0]?.segment.name ?? null,
        })),
        tags: drive.trafficTags.map((tag) => ({
          lat: tag.latitude,
          lng: tag.longitude,
          kind: tag.kind,
        })),
      }));

    const approaches = analyzeIntersections(analysisDrives).filter(
      (approach) => approach.passes >= minPasses
    );

    return NextResponse.json({
      approaches,
      summary: {
        driveCount: analysisDrives.length,
        approachCount: approaches.length,
        stopCount: approaches.reduce((total, a) => total + a.stopCount, 0),
        totalDelay: approaches.reduce((total, a) => total + a.totalDelay, 0),
        // Approaches whose denominator had to be raised to meet the stop count.
        // Should be 0; a non-zero value means those rates are floors, not
        // measurements, and is worth investigating rather than rendering plain.
        clampedCount: approaches.filter((a) => a.passesClamped).length,
        // Surfaced so the page can explain what "stopped" means here rather
        // than leaving the thresholds implicit.
        thresholds: {
          stoppedSpeedMph: DEFAULT_OPTIONS.stoppedSpeed * 2.23694,
          minStopSeconds: DEFAULT_OPTIONS.minStopDuration / 1000,
          clusterRadiusMeters: DEFAULT_OPTIONS.clusterRadius,
          bearingToleranceDegrees: DEFAULT_OPTIONS.bearingTolerance,
        },
      },
    });
  } catch (error) {
    console.error('Failed to analyze intersections:', error);
    return NextResponse.json({ error: 'Failed to analyze intersections' }, { status: 500 });
  }
}
