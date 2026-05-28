import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import {
  listPantoneColors,
  listFavoriteColors,
  getFavoriteTcxSet,
  COLOR_PAGE_SIZE,
} from '@/lib/production-colors/queries';
import { parseColorSearchParams } from '@/lib/production-colors/url-params';
import {
  ProductionColorsPageClient,
  type ProductionColorsTab,
} from '@/components/production-colors/ProductionColorsPageClient';

export const dynamic = 'force-dynamic';

function parseTab(raw?: string): ProductionColorsTab {
  if (raw === 'favorites' || raw === 'photo-analyzer') return raw;
  return 'all';
}

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default function ProductionColorsPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[200px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      }
    >
      <ProductionColorsPageContent {...props} />
    </Suspense>
  );
}

async function ProductionColorsPageContent({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const tab = parseTab(sp.tab);

  if (tab === 'photo-analyzer') {
    return <ProductionColorsPageClient tab={tab} browseProps={null} />;
  }

  const { filters, page, filterState } = parseColorSearchParams(sp);

  if (tab === 'favorites') {
    const { colors, totalCount } = await listFavoriteColors(
      session.user.id,
      filters,
      { page, pageSize: COLOR_PAGE_SIZE }
    );

    return (
      <ProductionColorsPageClient
        tab={tab}
        browseProps={{
          tab: 'favorites',
          initialColors: colors.map((c) => ({
            tcx: c.tcx,
            name: c.name,
            hex: c.hex,
            groupName: c.groupName,
            isFavorite: true,
          })),
          totalCount,
          page,
          initialFilters: filterState,
        }}
      />
    );
  }

  const { colors, totalCount } = await listPantoneColors(filters, {
    page,
    pageSize: COLOR_PAGE_SIZE,
  });

  const favoriteSet = await getFavoriteTcxSet(
    session.user.id,
    colors.map((c) => c.tcx)
  );

  return (
    <ProductionColorsPageClient
      tab="all"
      browseProps={{
        tab: 'all',
        initialColors: colors.map((c) => ({
          tcx: c.tcx,
          name: c.name,
          hex: c.hex,
          groupName: c.groupName,
          isFavorite: favoriteSet.has(c.tcx),
        })),
        totalCount,
        page,
        initialFilters: filterState,
      }}
    />
  );
}
