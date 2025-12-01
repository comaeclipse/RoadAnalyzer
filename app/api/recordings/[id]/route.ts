import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const drive = await prisma.drive.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        startTime: true,
        endTime: true,
        duration: true,
        distance: true,
        maxSpeed: true,
        avgSpeed: true,
        sampleCount: true,
        createdAt: true,
      },
    });

    if (!drive) {
      return NextResponse.json(
        { error: 'Drive not found' },
        { status: 404 }
      );
    }

    // Fetch GPS data for the route
    const gpsData = await prisma.gpsSample.findMany({
      where: { driveId: id },
      orderBy: { timestamp: 'asc' },
      select: {
        latitude: true,
        longitude: true,
        speed: true,
        timestamp: true,
      },
    });

    // Convert BigInt timestamps to numbers for JSON serialization
    const gpsPoints = gpsData.map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
      speed: point.speed,
      timestamp: Number(point.timestamp),
    }));

    return NextResponse.json({ drive, gpsPoints });
  } catch (error) {
    console.error('Failed to fetch recording:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recording' },
      { status: 500 }
    );
  }
}

