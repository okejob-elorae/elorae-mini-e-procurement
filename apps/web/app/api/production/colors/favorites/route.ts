import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  listFavoriteColors,
  COLOR_PAGE_SIZE,
  type ListPantoneFilters,
} from '@/lib/production-colors/queries';

export const dynamic = 'force-dynamic';

function parseListParam(value: string | null): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      96,
      Math.max(1, parseInt(searchParams.get('pageSize') ?? String(COLOR_PAGE_SIZE), 10) || COLOR_PAGE_SIZE)
    );
    const filters: ListPantoneFilters = {
      search: searchParams.get('search') ?? undefined,
      tone: parseListParam(searchParams.get('tone')),
      hue: parseListParam(searchParams.get('hue')),
      temperature: parseListParam(searchParams.get('temperature')),
      tint: parseListParam(searchParams.get('tint')),
    };

    const { colors, totalCount } = await listFavoriteColors(
      session.user.id,
      filters,
      { page, pageSize }
    );

    return NextResponse.json({
      colors: colors.map((c) => ({ ...c, isFavorite: true })),
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize) || 1,
    });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    if (status === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('GET /api/production/colors/favorites:', error);
    return NextResponse.json({ error: 'Failed to list favorites' }, { status: 500 });
  }
}
