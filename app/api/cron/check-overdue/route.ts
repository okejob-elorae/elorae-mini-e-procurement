import { NextRequest, NextResponse } from 'next/server';
import {
  checkAndSendOverdueNotifications,
  checkAndSendAccessoriesPendingCMTNotifications,
} from '@/app/actions/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [overdue, accessories] = await Promise.all([
      checkAndSendOverdueNotifications(),
      checkAndSendAccessoriesPendingCMTNotifications(),
    ]);
    return NextResponse.json({
      ok: true,
      overdue: { sent: overdue.sent },
      accessoriesCmt: { sent: accessories.sent, woCount: accessories.woCount },
    });
  } catch (err) {
    console.error('Cron check-overdue failed:', err);
    return NextResponse.json(
      { error: 'Internal error', message: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
