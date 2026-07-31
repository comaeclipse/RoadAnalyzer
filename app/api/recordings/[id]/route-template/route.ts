import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { name?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
      return NextResponse.json({ error: 'A route name of 1-120 characters is required' }, { status: 400 });
    }
    const drive = await prisma.drive.findUnique({
      where: { id: params.id },
      include: { tripAnalysis: true },
    });
    if (!drive?.tripAnalysis?.matchedGeometry || !drive.tripAnalysis.matchedDistance) {
      return NextResponse.json({ error: 'A completed map-matched drive is required' }, { status: 409 });
    }
    const template = await prisma.routeTemplate.upsert({
      where: { referenceDriveId: drive.id },
      create: {
        name: body.name.trim(), referenceDriveId: drive.id,
        geometry: drive.tripAnalysis.matchedGeometry as Prisma.InputJsonValue,
        distance: drive.tripAnalysis.matchedDistance,
        direction: drive.tripAnalysis.dominantDirection,
      },
      update: { name: body.name.trim(), isActive: true },
    });
    await prisma.drive.update({ where: { id: drive.id }, data: { routeTemplateId: template.id, name: drive.name || template.name } });
    return NextResponse.json({ template });
  } catch (error) {
    console.error('Failed to save route template:', error);
    return NextResponse.json({ error: 'Failed to save route template' }, { status: 500 });
  }
}
