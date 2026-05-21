import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const LIMIT = 50;

/**
 * GET /api/notifications
 * Returns notifications for the current user, paginated. Includes unread count.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [items, unreadCount] = await Promise.all([
      prisma.notificationQueue.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notificationQueue.count({
        where: {
          userId: session.user.id,
          readAt: null,
        },
      }),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (err) {
    console.error('GET /api/notifications failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
