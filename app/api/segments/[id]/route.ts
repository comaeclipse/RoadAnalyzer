import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UpdateSegmentRequest } from '@/types/segments';
import { calculateBoundingBox, isValidLineString } from '@/lib/segment-matching';

// GET /api/segments/[id] - Get segment details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const segment = await prisma.roadSegment.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: {
            congestionEvents: true,
            segmentStats: true,
          },
        },
      },
    });

    if (!segment) {
      return NextResponse.json(
        { error: 'Segment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      segment: {
        ...segment,
        geometry: segment.geometry as GeoJSON.LineString,
        eventCount: segment._count.congestionEvents,
        statsCount: segment._count.segmentStats,
        _count: undefined,
      },
    });
  } catch (error) {
    console.error('Failed to fetch segment:', error);
    return NextResponse.json(
      { error: 'Failed to fetch segment' },
      { status: 500 }
    );
  }
}

// PUT /api/segments/[id] - Update segment
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as UpdateSegmentRequest;
    const { name, description, geometry, roadType } = body;

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (roadType !== undefined) updateData.roadType = roadType;

    // If geometry is being updated, validate and recalculate bounding box
    if (geometry !== undefined) {
      if (!isValidLineString(geometry)) {
        return NextResponse.json(
          { error: 'Invalid LineString geometry' },
          { status: 400 }
        );
      }

      const bbox = calculateBoundingBox(geometry);
      updateData.geometry = geometry as any;
      updateData.minLat = bbox.minLat;
      updateData.maxLat = bbox.maxLat;
      updateData.minLon = bbox.minLon;
      updateData.maxLon = bbox.maxLon;
    }

    const segment = await prisma.roadSegment.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json({
      segment: {
        ...segment,
        geometry: segment.geometry as GeoJSON.LineString,
      },
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: 'Segment not found' },
        { status: 404 }
      );
    }
    console.error('Failed to update segment:', error);
    return NextResponse.json(
      { error: 'Failed to update segment' },
      { status: 500 }
    );
  }
}

// DELETE /api/segments/[id] - Delete segment
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.roadSegment.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: 'Segment not found' },
        { status: 404 }
      );
    }
    console.error('Failed to delete segment:', error);
    return NextResponse.json(
      { error: 'Failed to delete segment' },
      { status: 500 }
    );
  }
}
