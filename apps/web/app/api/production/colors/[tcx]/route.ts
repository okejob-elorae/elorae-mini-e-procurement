import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { getPantoneColorByTcx, isFavorite } from '@/lib/production-colors/queries';
import {
  enrichSimilarWithDeltaE,
  buildGradient,
  hexToRgbString,
} from '@/lib/pantone/match';
import type { FilterTags } from '@elorae/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ tcx: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);

    const { tcx: rawTcx } = await context.params;
    const tcx = decodeURIComponent(rawTcx);
    const color = await getPantoneColorByTcx(tcx);
    if (!color) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const similar = enrichSimilarWithDeltaE(color.hex, [], 24);
    const gradient = buildGradient(color.hex, 9);
    const favorited = await isFavorite(session.user.id, tcx);

    const rgb = `${color.rgbR}, ${color.rgbG}, ${color.rgbB}`;
    return NextResponse.json({
      tcx: color.tcx,
      name: color.name,
      hex: color.hex,
      rgb,
      rgbString: hexToRgbString(color.hex),
      groupName: color.groupName,
      filterTags: color.filterTags as FilterTags,
      lab: color.labL != null ? { L: color.labL, a: color.labA, b: color.labB } : null,
      gradient,
      similar,
      isFavorite: favorited,
    });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    if (status === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('GET /api/production/colors/[tcx]:', error);
    return NextResponse.json({ error: 'Failed to load color' }, { status: 500 });
  }
}
