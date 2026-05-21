import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/notifications/register
 * Body: { token: string } — FCM device token from firebase/messaging getToken().
 * Updates the authenticated user's fcmToken so server can send push via Firebase Admin.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : null;
    if (!token) {
      return NextResponse.json(
        { error: 'Missing or invalid token' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { fcmToken: token },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('FCM token registration failed:', err);
    return NextResponse.json(
      { error: 'Failed to register token' },
      { status: 500 }
    );
  }
}
