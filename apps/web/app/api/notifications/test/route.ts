import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { messaging } from '@/lib/firebase/admin';

const TEST_TYPE = 'TEST';
const DEFAULT_HREF = '/backoffice/dashboard';

/**
 * POST /api/notifications/test
 * Creates a test notification for the current user and sends FCM if token exists.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, fcmToken: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const title = 'Test notification';
    const body = 'This is a test notification from the app.';
    const data = { type: TEST_TYPE, href: DEFAULT_HREF };

    const row = await prisma.notificationQueue.create({
      data: {
        userId: user.id,
        type: TEST_TYPE,
        title,
        body,
        data,
        sent: false,
      },
    });

    if (user.fcmToken && messaging) {
      try {
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          data: { type: TEST_TYPE, href: DEFAULT_HREF },
        });
        await prisma.notificationQueue.update({
          where: { id: row.id },
          data: { sent: true, sentAt: new Date() },
        });
      } catch (err) {
        console.error('FCM test send failed:', err);
      }
    }

    return NextResponse.json({ success: true, id: row.id });
  } catch (err) {
    console.error('POST /api/notifications/test failed:', err);
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    );
  }
}
