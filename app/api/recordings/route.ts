import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const drives = await prisma.drive.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
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
      },
    });

    return NextResponse.json({ drives }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Failed to fetch recordings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recordings' },
      { status: 500 }
    );
  }
}

