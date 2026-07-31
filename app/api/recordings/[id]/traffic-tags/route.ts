import { NextRequest, NextResponse } from 'next/server';
import { TrafficTagKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const tagKinds = new Set(Object.values(TrafficTagKind));

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as {
      featureKey?: unknown;
      featureType?: unknown;
      kind?: unknown;
      note?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      duration?: unknown;
    };
    if (typeof body.featureKey !== 'string' || body.featureKey.length === 0 || body.featureKey.length > 160 ||
      typeof body.featureType !== 'string' || body.featureType.length === 0 || body.featureType.length > 40 ||
      typeof body.kind !== 'string' || !tagKinds.has(body.kind as TrafficTagKind) ||
      typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90 ||
      typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180 ||
      typeof body.startTime !== 'number' || !Number.isFinite(body.startTime) ||
      typeof body.endTime !== 'number' || !Number.isFinite(body.endTime) || body.endTime < body.startTime ||
      typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration < 0) {
      return NextResponse.json({ error: 'Invalid traffic tag' }, { status: 400 });
    }
    const tag = await prisma.trafficTag.upsert({
      where: { driveId_featureKey: { driveId: params.id, featureKey: body.featureKey } },
      create: {
        driveId: params.id,
        featureKey: body.featureKey,
        featureType: body.featureType,
        kind: body.kind as TrafficTagKind,
        note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
        latitude: body.latitude,
        longitude: body.longitude,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        duration: Math.round(body.duration),
      },
      update: {
        kind: body.kind as TrafficTagKind,
        note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
        latitude: body.latitude,
        longitude: body.longitude,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        duration: Math.round(body.duration),
      },
    });
    return NextResponse.json({ tag });
  } catch (error) {
    console.error('Failed to save traffic tag:', error);
    return NextResponse.json({ error: 'Failed to save traffic tag' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const featureKey = request.nextUrl.searchParams.get('featureKey');
  if (!featureKey) return NextResponse.json({ error: 'featureKey is required' }, { status: 400 });
  await prisma.trafficTag.deleteMany({ where: { driveId: params.id, featureKey } });
  return NextResponse.json({ success: true });
}
