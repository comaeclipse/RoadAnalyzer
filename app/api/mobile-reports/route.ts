import { NextRequest, NextResponse } from 'next/server';
import { DriveSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calculateDistance } from '@/lib/sensor-utils';
import {
  MOBILE_TRAFFIC_TAG_FEATURE_TYPE,
  MOBILE_TRAFFIC_TAG_KINDS,
  MobilePausedInterval,
  MobileTrafficTag,
  isWithinPause,
  totalPausedDuration,
  validateMobileReport,
} from '@/lib/mobile-report';
import {
  AnalysisBusyError,
  RetryableAnalysisError,
  runDriveAnalysis,
} from '@/lib/trip-analysis';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Report payload exceeds 15 MB' }, { status: 413 });
  }

  try {
    const parsed = validateMobileReport(await request.json());
    if (!parsed.valid) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const report = parsed.value;

    const existing = await prisma.drive.findUnique({
      where: { idempotencyKey: report.idempotencyKey },
      include: { tripAnalysis: true },
    });
    if (existing?.tripAnalysis &&
        ['COMPLETED', 'PARTIAL'].includes(existing.tripAnalysis.status)) {
      return NextResponse.json({
        driveId: existing.id,
        duplicate: true,
        status: existing.status,
        analysis: existing.tripAnalysis,
      });
    }

    const pauses = report.pausedIntervals ?? [];
    const pausedDuration = totalPausedDuration(pauses, report.endedAt);

    let distance = 0;
    const gpsData = report.locations.map((point, index) => {
      const previous = report.locations[index - 1];
      const distanceFromPrev = previous
        ? calculateDistance(previous.latitude, previous.longitude, point.latitude, point.longitude)
        : null;
      // A pause turns off GPS, so the pair straddling it is a straight line
      // across however far the driver travelled meanwhile -- a 40 km detour to
      // a gas station would otherwise be counted as 40 km of driving. The
      // per-sample distanceFromPrev is left intact; only the total skips it.
      const straddlesPause = previous
        ? isWithinPause(pauses, previous.timestamp, report.endedAt) ||
          isWithinPause(pauses, point.timestamp, report.endedAt)
        : false;
      if (!straddlesPause) distance += distanceFromPrev ?? 0;
      return {
        latitude: point.latitude,
        longitude: point.longitude,
        altitude: point.altitude ?? null,
        speed: point.speed ?? null,
        heading: point.heading ?? null,
        accuracy: point.accuracy,
        speedAccuracy: point.speedAccuracy ?? null,
        courseAccuracy: point.courseAccuracy ?? null,
        timestamp: BigInt(Math.round(point.timestamp)),
        distanceFromPrev,
      };
    });
    const speeds = gpsData.flatMap((sample) => sample.speed == null ? [] : [sample.speed]);

    // Phone-tagged stops become ordinary TrafficTag rows. lib/intersection-stops.ts
    // detects the stop clusters itself from the GPS trace and reads these purely
    // by proximity to decide a cluster's kind, so nothing downstream needs to
    // know the label came from the phone rather than the web tagging UI.
    const trafficTagRows = (report.trafficTags ?? []).map((tag: MobileTrafficTag) => ({
      featureKey: tag.id,
      featureType: MOBILE_TRAFFIC_TAG_FEATURE_TYPE,
      kind: MOBILE_TRAFFIC_TAG_KINDS[tag.kind],
      latitude: tag.latitude,
      longitude: tag.longitude,
      startTime: new Date(tag.startedAt),
      endTime: new Date(tag.endedAt),
      duration: Math.round(tag.endedAt - tag.startedAt),
      // The device's approach cluster and where the driver answered. Kept in the
      // free-text note because TrafficTag has no column for either, and both are
      // worth having when reconciling a label against the server's own clusters.
      note: [
        tag.anchorId ? `anchor=${tag.anchorId}` : null,
        tag.taggedDuring ? `tagged=${tag.taggedDuring.toLowerCase()}` : null,
        tag.heading == null ? null : `approach=${Math.round(tag.heading)}`,
      ].filter(Boolean).join(' ') || null,
    }));

    const pausedIntervalRows = pauses.map((pause: MobilePausedInterval) => ({
      clientId: pause.id,
      startedAt: new Date(pause.startedAt),
      endedAt: pause.endedAt == null ? null : new Date(pause.endedAt),
      duration: pause.endedAt == null ? null : Math.round(pause.endedAt - pause.startedAt),
      endedBy: pause.endedBy ?? null,
    }));
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
        // Time the driver deliberately excluded is not driving time.
        duration: Math.round(report.endedAt - report.startedAt - pausedDuration),
        pausedDuration: pausedDuration > 0 ? Math.round(pausedDuration) : null,
        distance,
        maxSpeed: speeds.length ? Math.max(...speeds) : null,
        avgSpeed: speeds.length ? speeds.reduce((total, speed) => total + speed, 0) / speeds.length : null,
        sampleCount: gpsData.length + (report.motionSamples?.length ?? 0),
        gpsData: { create: gpsData },
        trafficTags: { create: trafficTagRows },
        pausedIntervals: { create: pausedIntervalRows },
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

    let driveId = existing?.id;
    if (!driveId) {
      try {
        driveId = (await createDrive()).id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          driveId = (await prisma.drive.findUnique({
            where: { idempotencyKey: report.idempotencyKey },
            select: { id: true },
          }))?.id;
        }
        if (!driveId) throw error;
      }
    } else {
      // The drive already exists because a previous attempt created it and then
      // failed in analysis. createDrive() is skipped on that path, so its
      // nested creates never run -- without this the retry that finally
      // succeeds would persist a drive with no stop events at all. The
      // [driveId, clientId] unique index makes skipDuplicates exact rather than
      // best-effort, so a retry that partially landed is also repaired.
      if (trafficTagRows.length) {
        await prisma.trafficTag.createMany({
          data: trafficTagRows.map((row) => ({ ...row, driveId: driveId as string })),
          skipDuplicates: true,
        });
      }
      if (pausedIntervalRows.length) {
        await prisma.pausedInterval.createMany({
          data: pausedIntervalRows.map((row) => ({ ...row, driveId: driveId as string })),
          skipDuplicates: true,
        });
      }
    }

    try {
      const analysis = await runDriveAnalysis(driveId);
      await prisma.drive.update({
        where: { id: driveId },
        data: { status: 'COMPLETED', uploadCompletedAt: new Date() },
      });
      // Report what actually landed rather than what was sent, so a client can
      // tell a dropped tag from a rejected one.
      const trafficTagCount = await prisma.trafficTag.count({ where: { driveId } });
      return NextResponse.json(
        { driveId, duplicate: Boolean(existing), trafficTagCount, analysis },
        { status: existing ? 200 : 201 }
      );
    } catch (error) {
      if (error instanceof AnalysisBusyError || error instanceof RetryableAnalysisError) {
        return NextResponse.json(
          {
            error: 'Trip analysis is temporarily unavailable',
            driveId,
            retryable: true,
            code: error instanceof RetryableAnalysisError ? error.code : 'ANALYSIS_BUSY',
          },
          { status: 503 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('Failed to ingest mobile report:', error);
    return NextResponse.json({ error: 'Failed to ingest mobile report' }, { status: 500 });
  }
}
