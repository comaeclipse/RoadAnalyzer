import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StopRecordingRequest } from '@/types/recordings';
import { analyzeRoughness } from '@/lib/roughness';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StopRecordingRequest;
    const { driveId } = body;

    if (!driveId) {
      return NextResponse.json(
        { error: 'Drive ID is required' },
        { status: 400 }
      );
    }

    // Fetch GPS and accelerometer data to calculate statistics
    const [gpsData, accelData] = await Promise.all([
      prisma.gpsSample.findMany({
        where: { driveId },
        orderBy: { timestamp: 'asc' },
        select: {
          speed: true,
          timestamp: true,
          distanceFromPrev: true,
        },
      }),
      prisma.accelerometerSample.findMany({
        where: { driveId },
        orderBy: { timestamp: 'asc' },
        select: {
          x: true,
          y: true,
          z: true,
          timestamp: true,
        },
      }),
    ]);

    // Calculate total distance
    const totalDistance = gpsData.reduce(
      (sum: number, sample: { distanceFromPrev: number | null }) =>
        sum + (sample.distanceFromPrev ?? 0),
      0
    );

    // Calculate speed statistics
    const speeds = gpsData
      .map((s: { speed: number | null }) => s.speed)
      .filter((s: number | null): s is number => s !== null && s !== undefined);

    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : null;
    const avgSpeed =
      speeds.length > 0
        ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length
        : null;

    // Calculate duration
    const startTime = gpsData[0]?.timestamp || BigInt(Date.now());
    const endTime = gpsData[gpsData.length - 1]?.timestamp || BigInt(Date.now());
    const duration = Number(endTime - startTime);

    // Calculate road roughness
    const accelSamples = accelData.map((s) => ({
      x: s.x,
      y: s.y,
      z: s.z,
      timestamp: Number(s.timestamp),
    }));
    
    const roughnessResult = analyzeRoughness(accelSamples);

    // Update drive with final statistics
    const drive = await prisma.drive.update({
      where: { id: driveId },
      data: {
        endTime: new Date(),
        status: 'COMPLETED',
        duration,
        distance: totalDistance,
        maxSpeed,
        avgSpeed,
        sampleCount: gpsData.length + accelData.length,
        roughnessScore: roughnessResult?.score ?? null,
        roughnessBreakdown: roughnessResult?.breakdown ?? null,
      },
    });

    return NextResponse.json({ drive });
  } catch (error) {
    console.error('Failed to stop recording:', error);
    return NextResponse.json(
      { error: 'Failed to stop recording' },
      { status: 500 }
    );
  }
}
