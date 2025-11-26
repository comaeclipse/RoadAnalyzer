import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StartRecordingRequest } from '@/types/recordings';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartRecordingRequest;
    const { name, description, tags } = body;

    const drive = await prisma.drive.create({
      data: {
        startTime: new Date(),
        status: 'RECORDING',
        name: name || `Drive ${new Date().toLocaleString()}`,
        description: description || null,
        tags: tags || [],
      },
    });

    return NextResponse.json({ driveId: drive.id }, { status: 201 });
  } catch (error) {
    console.error('Failed to start recording:', error);
    return NextResponse.json(
      { error: 'Failed to start recording' },
      { status: 500 }
    );
  }
}
