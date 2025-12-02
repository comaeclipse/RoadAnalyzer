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
        gpsData: {
          orderBy: { timestamp: 'asc' },
          select: {
            latitude: true,
            longitude: true,
            timestamp: true,
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
        points: drive.gpsData.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        })),
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

