import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get all completed drives with their GPS data
    const drives = await prisma.drive.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        distance: true,
        roughnessScore: true,
        tripAnalysis: {
          select: {
            status: true,
            matchedGeometry: true,
            coverage: true,
            confidence: true,
            errorCode: true,
          },
        },
        gpsData: {
          orderBy: { timestamp: 'asc' },
          select: {
            latitude: true,
            longitude: true,
            timestamp: true,
            segmentMatches: { take: 1, select: { source: true, confidence: true } },
          },
        },
      },
    });

    // Convert to a simpler format
    const routes = drives
      .filter((d) => d.gpsData.length > 0)
      .map((drive) => ({
        id: drive.id,
        name: drive.name,
        createdAt: drive.createdAt,
        distance: drive.distance,
        roughnessScore: drive.roughnessScore,
        tripAnalysis: drive.tripAnalysis,
        points: drive.gpsData.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        })),
        matchDiagnostics: {
          matchedPoints: drive.gpsData.filter((point) => point.segmentMatches.length > 0).length,
          unmatchedPoints: drive.gpsData.filter((point) => point.segmentMatches.length === 0).length,
          manualOverrides: drive.gpsData.filter((point) =>
            point.segmentMatches[0]?.source === 'MANUAL_OVERRIDE' ||
            point.segmentMatches[0]?.source === 'MANUAL_FALLBACK'
          ).length,
          lowConfidencePoints: drive.gpsData.filter((point) =>
            point.segmentMatches[0]?.confidence != null &&
            point.segmentMatches[0].confidence! < 0.5
          ).length,
        },
      }));

    return NextResponse.json({ routes });
  } catch (error) {
    console.error('Failed to fetch routes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routes' },
      { status: 500 }
    );
  }
}

