import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * PATCH /api/notifications/[id]/read
 * Marks the notification as read for the current user.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Missing notification id' },
        { status: 400 }
      );
    }

    await prisma.notificationQueue.updateMany({
      where: {
        id,
        userId: session.user.id,
      },
      data: { readAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/notifications/[id]/read failed:', err);
    return NextResponse.json(
      { error: 'Failed to mark as read' },
      { status: 500 }
    );
  }
}
