import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@elorae/db';
export const dynamic = 'force-dynamic';


/**
 * POST /api/notifications/register
 * Body: { token: string } — FCM device token from firebase/messaging getToken().
 * Updates the authenticated user's fcmToken so server can send push via Firebase Admin.
 *
 * A token identifies a DEVICE, not a person: on a shared phone the previous user's row still
 * holds it, and every push meant for them would land on the next user's screen. So the token
 * is taken off every other user in the same transaction that gives it to this one.
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

    const userId = session.user.id;
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { fcmToken: token, NOT: { id: userId } },
        data: { fcmToken: null },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { fcmToken: token },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('FCM token registration failed:', err);
    return NextResponse.json(
      { error: 'Failed to register token' },
      { status: 500 }
    );
  }
}
