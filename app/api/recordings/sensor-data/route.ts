import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SensorDataBatch } from '@/types/recordings';
import { AccelerometerData, GPSData } from '@/types/sensors';
import { calculateDistance } from '@/lib/sensor-utils';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SensorDataBatch;
    const { driveId, type, samples } = body;

    if (!driveId || !type || !samples || !Array.isArray(samples)) {
      return NextResponse.json(
        { error: 'Invalid request: driveId, type, and samples are required' },
        { status: 400 }
      );
    }

    if (samples.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // Verify drive exists and is recording
    const drive = await prisma.drive.findUnique({
      where: { id: driveId },
      select: { status: true },
    });

    if (!drive) {
      return NextResponse.json(
        { error: 'Drive not found' },
        { status: 404 }
      );
    }

    if (drive.status !== 'RECORDING') {
      return NextResponse.json(
        { error: 'Drive is not actively recording' },
        { status: 400 }
      );
    }

    // Process based on sensor type
    if (type === 'accelerometer') {
      const accelSamples = samples as AccelerometerData[];

      // Calculate magnitude for each sample
      const data = accelSamples.map((s) => ({
        driveId,
        x: s.x,
        y: s.y,
        z: s.z,
        timestamp: BigInt(s.timestamp),
        magnitude: Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2),
      }));

      await prisma.accelerometerSample.createMany({ data });

      // Update sample count asynchronously (fire-and-forget)
      prisma.drive
        .update({
          where: { id: driveId },
          data: { sampleCount: { increment: data.length } },
        })
        .catch((err: unknown) =>
          console.error('Failed to update sample count:', err)
        );

      return NextResponse.json({
        success: true,
        count: data.length,
      });
    } else if (type === 'gps') {
      const gpsSamples = samples as GPSData[];

      // Get the last GPS sample to calculate distance from previous
      const lastGps = await prisma.gpsSample.findFirst({
        where: { driveId },
        orderBy: { timestamp: 'desc' },
        select: { latitude: true, longitude: true },
      });

      // Calculate distance from previous point for each sample
      const data = gpsSamples.map((s, idx) => {
        let distanceFromPrev: number | null = null;

        if (idx === 0 && lastGps) {
          // First sample in batch: calculate from last saved GPS point
          distanceFromPrev = calculateDistance(
            Number(lastGps.latitude),
            Number(lastGps.longitude),
            s.latitude,
            s.longitude
          );
        } else if (idx > 0) {
          // Subsequent samples: calculate from previous sample in batch
          distanceFromPrev = calculateDistance(
            gpsSamples[idx - 1].latitude,
            gpsSamples[idx - 1].longitude,
            s.latitude,
            s.longitude
          );
        }

        return {
          driveId,
          latitude: s.latitude,
          longitude: s.longitude,
          altitude: s.altitude ?? null,
          speed: s.speed ?? null,
          heading: s.heading ?? null,
          accuracy: s.accuracy,
          timestamp: BigInt(s.timestamp),
          distanceFromPrev,
        };
      });

      await prisma.gpsSample.createMany({ data });

      // Update sample count asynchronously (fire-and-forget)
      prisma.drive
        .update({
          where: { id: driveId },
          data: { sampleCount: { increment: data.length } },
        })
        .catch((err: unknown) =>
          console.error('Failed to update sample count:', err)
        );

      return NextResponse.json({
        success: true,
        count: data.length,
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid sensor type. Must be "accelerometer" or "gps"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Failed to save sensor data:', error);
    return NextResponse.json(
      { error: 'Failed to save sensor data' },
      { status: 500 }
    );
  }
}
