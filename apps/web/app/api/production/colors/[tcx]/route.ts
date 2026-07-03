import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { getPantoneColorByTcx, isFavorite, getFavoriteTcxSet } from '@/lib/production-colors/queries';
import {
  enrichSimilarWithDeltaE,
  buildGradient,
  hexToRgbString,
} from '@/lib/pantone/match';
import type { FilterTags } from "@elorae/db/pantone";

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
    const gradient = buildGradient(color.hex, 10);
    const favorited = await isFavorite(session.user.id, tcx);
    const favoriteSet = await getFavoriteTcxSet(session.user.id, [
      tcx,
      ...similar.map((s) => s.tcx),
    ]);

    const rgb = `${color.rgbR}, ${color.rgbG}, ${color.rgbB}`;
    const bookPosition =
      color.bookSection != null &&
      color.bookPage != null &&
      color.bookColumn != null &&
      color.bookRow != null
        ? {
            section: color.bookSection,
            page: color.bookPage,
            column: color.bookColumn,
            row: color.bookRow,
          }
        : null;

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
      similar: similar.map((s) => ({
        ...s,
        isFavorite: favoriteSet.has(s.tcx),
      })),
      isFavorite: favorited,
      bookPosition,
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
