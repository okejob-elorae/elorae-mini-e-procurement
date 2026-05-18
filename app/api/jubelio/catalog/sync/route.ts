import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { syncCatalog } from '@/lib/jubelio/sync-catalog';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

    const body = (await req.json().catch(() => ({}))) as {
      dryRun?: boolean;
      source?: 'api' | 'snapshot';
      itemGroupIds?: number[];
      enrichDescriptions?: boolean;
    };

    const source = body.source ?? 'api';
    if (source === 'snapshot' && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Snapshot source is only allowed in development' },
        { status: 400 }
      );
    }

    const result = await syncCatalog({
      dryRun: body.dryRun ?? false,
      source,
      itemGroupIds: body.itemGroupIds,
      enrichDescriptions: body.enrichDescriptions ?? false,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Jubelio catalog sync failed:', error);
    const message = error instanceof Error ? error.message : 'Catalog sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
