import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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
        roughnessScore: true,
        roughnessBreakdown: true,
      },
    });

    if (!drive) {
      return NextResponse.json(
        { error: 'Drive not found' },
        { status: 404 }
      );
    }

    // Fetch GPS and accelerometer data in parallel
    const [gpsData, accelData] = await Promise.all([
      prisma.gpsSample.findMany({
        where: { driveId: id },
        orderBy: { timestamp: 'asc' },
        select: {
          latitude: true,
          longitude: true,
          speed: true,
          timestamp: true,
        },
      }),
      prisma.accelerometerSample.findMany({
        where: { driveId: id },
        orderBy: { timestamp: 'asc' },
        select: {
          x: true,
          y: true,
          z: true,
          magnitude: true,
          timestamp: true,
        },
      }),
    ]);

    // Convert BigInt timestamps to numbers for JSON serialization
    const gpsPoints = gpsData.map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
      speed: point.speed,
      timestamp: Number(point.timestamp),
    }));

    const accelPoints = accelData.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      magnitude: point.magnitude,
      timestamp: Number(point.timestamp),
    }));

    return NextResponse.json({ drive, gpsPoints, accelPoints });
  } catch (error) {
    console.error('Failed to fetch recording:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recording' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = (await request.json()) as {
      points: { lat: number; lng: number }[];
    };

    if (!body?.points || !Array.isArray(body.points) || body.points.length === 0) {
      return NextResponse.json({ error: 'points array required' }, { status: 400 });
    }

    // Get existing GPS samples in order
    const samples = await prisma.gpsSample.findMany({
      where: { driveId: id },
      orderBy: { timestamp: 'asc' },
      select: { id: true, timestamp: true },
    });

    if (samples.length === 0) {
      return NextResponse.json({ error: 'No GPS samples for drive' }, { status: 404 });
    }

    if (samples.length !== body.points.length) {
      return NextResponse.json(
        { error: `Point count mismatch. Existing ${samples.length}, received ${body.points.length}` },
        { status: 400 }
      );
    }

    // Update each sample with new lat/lng
    await prisma.$transaction(
      samples.map((s, idx) =>
        prisma.gpsSample.update({
          where: { id: s.id },
          data: {
            latitude: body.points[idx].lat,
            longitude: body.points[idx].lng,
          },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update recording route:', error);
    return NextResponse.json(
      { error: 'Failed to update recording route' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Delete the drive (cascades to samples due to schema)
    await prisma.drive.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete recording:', error);
    return NextResponse.json(
      { error: 'Failed to delete recording' },
      { status: 500 }
    );
  }
}
