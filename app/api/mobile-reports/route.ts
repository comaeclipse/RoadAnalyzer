import { NextRequest, NextResponse } from 'next/server';
import { DriveSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calculateDistance } from '@/lib/sensor-utils';
import { validateMobileReport } from '@/lib/mobile-report';
import { runCongestionAnalysis } from '@/lib/post-processing';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Report payload exceeds 15 MB' }, { status: 413 });
  }

  try {
    const parsed = validateMobileReport(await request.json());
    if (!parsed.valid) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const report = parsed.value;

    const duplicateResponse = async () => {
      const existing = await prisma.drive.findUnique({ where: { idempotencyKey: report.idempotencyKey } });
      return existing
        ? NextResponse.json({ driveId: existing.id, duplicate: true, status: existing.status })
        : null;
    };

    const alreadyIngested = await duplicateResponse();
    if (alreadyIngested) return alreadyIngested;

    let distance = 0;
    const gpsData = report.locations.map((point, index) => {
      const previous = report.locations[index - 1];
      const distanceFromPrev = previous
        ? calculateDistance(previous.latitude, previous.longitude, point.latitude, point.longitude)
        : null;
      distance += distanceFromPrev ?? 0;
      return {
        latitude: point.latitude,
        longitude: point.longitude,
        altitude: point.altitude ?? null,
        speed: point.speed ?? null,
        heading: point.heading ?? null,
        accuracy: point.accuracy,
        timestamp: BigInt(Math.round(point.timestamp)),
        distanceFromPrev,
      };
    });
    const speeds = gpsData.flatMap((sample) => sample.speed == null ? [] : [sample.speed]);
    // The pre-check above cannot be trusted on its own: a client that retries
    // while its first request is still in flight puts two creates in the air at
    // once, and both pass the check. The unique index is the real guard, so a
    // P2002 here means a concurrent request already ingested this report.
    const createDrive = () => prisma.drive.create({
      data: {
        startTime: new Date(report.startedAt),
        endTime: new Date(report.endedAt),
        status: 'RECORDING',
        recordingMode: 'TRAFFIC',
        source: DriveSource.IOS,
        idempotencyKey: report.idempotencyKey,
        appSchemaVersion: report.schemaVersion,
        trafficAnalysisVersion: report.trafficAnalysisVersion ?? '1',
        deviceModel: report.device?.model ?? null,
        osVersion: report.device?.osVersion ?? null,
        diagnostics: report.diagnostics ? JSON.parse(JSON.stringify(report.diagnostics)) : undefined,
        name: report.name?.slice(0, 120) || 'iPhone traffic report',
        tags: ['ios', 'traffic'],
        duration: Math.round(report.endedAt - report.startedAt),
        distance,
        maxSpeed: speeds.length ? Math.max(...speeds) : null,
        avgSpeed: speeds.length ? speeds.reduce((total, speed) => total + speed, 0) / speeds.length : null,
        sampleCount: gpsData.length + (report.motionSamples?.length ?? 0),
        gpsData: { create: gpsData },
        accelerometerData: {
          create: (report.motionSamples ?? []).map((sample) => ({
            x: sample.x,
            y: sample.y,
            z: sample.z,
            timestamp: BigInt(Math.round(sample.timestamp)),
            magnitude: Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2),
          })),
        },
      },
    });

    let drive;
    try {
      drive = await createDrive();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await duplicateResponse();
        if (raced) return raced;
      }
      throw error;
    }

    const analysis = await runCongestionAnalysis(drive.id);
    await prisma.drive.update({
      where: { id: drive.id },
      data: { status: 'COMPLETED', uploadCompletedAt: new Date() },
    });
    return NextResponse.json({ driveId: drive.id, duplicate: false, analysis }, { status: 201 });
  } catch (error) {
    console.error('Failed to ingest mobile report:', error);
    return NextResponse.json({ error: 'Failed to ingest mobile report' }, { status: 500 });
  }
}
