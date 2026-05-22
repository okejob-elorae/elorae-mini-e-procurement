import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listFavoriteColors, COLOR_PAGE_SIZE } from '@/lib/production-colors/queries';
import { ColorsBrowseClient } from '@/components/production-colors/ColorsBrowseClient';
import type { ColorFiltersState } from '@/components/production-colors/ColorsFilterBar';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{
    search?: string;
    tone?: string;
    hue?: string;
    temperature?: string;
    tint?: string;
    page?: string;
  }>;
};

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export default async function ProductionColorsFavoritesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const filters: ColorFiltersState = {
    search: sp.search?.trim() ?? '',
    tone: parseList(sp.tone),
    hue: parseList(sp.hue),
    temperature: parseList(sp.temperature),
    tint: parseList(sp.tint),
  };
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const { colors, totalCount } = await listFavoriteColors(
    session.user.id,
    {
      search: filters.search || undefined,
      tone: filters.tone.length ? filters.tone : undefined,
      hue: filters.hue.length ? filters.hue : undefined,
      temperature: filters.temperature.length ? filters.temperature : undefined,
      tint: filters.tint.length ? filters.tint : undefined,
    },
    { page, pageSize: COLOR_PAGE_SIZE }
  );

  return (
    <ColorsBrowseClient
      mode="favorites"
      initialColors={colors.map((c) => ({
        tcx: c.tcx,
        name: c.name,
        hex: c.hex,
        groupName: c.groupName,
        isFavorite: true,
      }))}
      totalCount={totalCount}
      page={page}
      initialFilters={filters}
    />
  );
}
