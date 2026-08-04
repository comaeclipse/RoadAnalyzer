import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// PATCH /api/routes/[id] - Rename a route or toggle whether it is matched against
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as { name?: unknown; isActive?: unknown };
    const data: { name?: string; isActive?: boolean } = {};

    if (body.name !== undefined) {
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 120
      ) {
        return NextResponse.json(
          { error: 'A route name of 1-120 characters is required' },
          { status: 400 }
        );
      }
      data.name = body.name.trim();
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json(
          { error: 'isActive must be a boolean' },
          { status: 400 }
        );
      }
      data.isActive = body.isActive;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Provide a name or isActive to update' },
        { status: 400 }
      );
    }

    const template = await prisma.routeTemplate.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ template });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    console.error('Failed to update route:', error);
    return NextResponse.json({ error: 'Failed to update route' }, { status: 500 });
  }
}

// DELETE /api/routes/[id] - Delete a route template
//
// Drives keep their recordings; Drive.routeTemplateId is onDelete: SetNull, so
// they simply become unassigned. Nothing recorded is lost.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const template = await prisma.routeTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { drives: true } } },
    });
    if (!template) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    await prisma.routeTemplate.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true, unassignedDrives: template._count.drives });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    console.error('Failed to delete route:', error);
    return NextResponse.json({ error: 'Failed to delete route' }, { status: 500 });
  }
}
