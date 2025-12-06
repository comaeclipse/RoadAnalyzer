import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CreateSegmentRequest } from '@/types/segments';
import { calculateBoundingBox, isValidLineString } from '@/lib/segment-matching';

// GET /api/segments - List all segments
export async function GET(request: NextRequest) {
  try {
    const segments = await prisma.roadSegment.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        name: true,
        description: true,
        geometry: true,
        minLat: true,
        maxLat: true,
        minLon: true,
        maxLon: true,
        roadType: true,
        source: true,
        sourceId: true,
        _count: {
          select: {
            congestionEvents: true,
          },
        },
      },
    });

    const response = {
      segments: segments.map(s => ({
        ...s,
        geometry: s.geometry as GeoJSON.LineString,
        eventCount: s._count.congestionEvents,
        _count: undefined,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch segments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch segments' },
      { status: 500 }
    );
  }
}

// POST /api/segments - Create new segment
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateSegmentRequest;
    const { name, description, geometry, roadType } = body;

    // Validate required fields
    if (!name || !geometry) {
      return NextResponse.json(
        { error: 'Name and geometry are required' },
        { status: 400 }
      );
    }

    // Validate geometry
    if (!isValidLineString(geometry)) {
      return NextResponse.json(
        { error: 'Invalid LineString geometry' },
        { status: 400 }
      );
    }

    // Calculate bounding box
    const bbox = calculateBoundingBox(geometry);

    // Create segment
    const segment = await prisma.roadSegment.create({
      data: {
        name,
        description: description || null,
        geometry: geometry as any, // Prisma Json type
        roadType: roadType || null,
        source: 'MANUAL',
        minLat: bbox.minLat,
        maxLat: bbox.maxLat,
        minLon: bbox.minLon,
        maxLon: bbox.maxLon,
      },
    });

    return NextResponse.json({
      segment: {
        ...segment,
        geometry: segment.geometry as GeoJSON.LineString,
      },
    });
  } catch (error) {
    console.error('Failed to create segment:', error);
    return NextResponse.json(
      { error: 'Failed to create segment' },
      { status: 500 }
    );
  }
}
