import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { matchHexToPantone, normalizeHex } from '@/lib/pantone/match';
import { getFavoriteTcxSet } from '@/lib/production-colors/queries';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);

    const body = (await req.json()) as { hex?: string; limit?: number };
    if (!body.hex?.trim()) {
      return NextResponse.json({ error: 'hex is required' }, { status: 400 });
    }

    const hex = normalizeHex(body.hex);
    const limit = Math.min(20, Math.max(1, body.limit ?? 5));
    const matches = matchHexToPantone(hex, limit);
    const favoriteSet = await getFavoriteTcxSet(
      session.user.id,
      matches.map((m) => m.tcx)
    );

    return NextResponse.json({
      inputHex: hex,
      matches: matches.map((m) => ({
        ...m,
        isFavorite: favoriteSet.has(m.tcx),
      })),
    });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    if (status === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('POST /api/production/colors/match:', error);
    return NextResponse.json({ error: 'Failed to match color' }, { status: 500 });
  }
}
