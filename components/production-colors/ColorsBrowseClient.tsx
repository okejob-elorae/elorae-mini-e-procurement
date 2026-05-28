'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import {
  ColorsFilterBar,
  FilterSummaryBadges,
  type ColorFiltersState,
} from '@/components/production-colors/ColorsFilterBar';
import { ColorSwatchGrid } from '@/components/production-colors/ColorSwatchGrid';
import { PantoneColorDetailDialog } from '@/components/production-colors/PantoneColorDetailDialog';
import type { PantoneSwatch } from '@/components/production-colors/types';
import { COLOR_PAGE_SIZE } from '@/lib/production-colors/constants';

type ColorsBrowseClientProps = {
  tab: 'all' | 'favorites';
  initialColors: PantoneSwatch[];
  totalCount: number;
  page: number;
  pageSize?: number;
  initialFilters: ColorFiltersState;
};

function buildQueryString(
  filters: ColorFiltersState,
  page: number,
  tab: 'all' | 'favorites'
): string {
  const params = new URLSearchParams();
  if (tab === 'favorites') params.set('tab', 'favorites');
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.tone.length) params.set('tone', filters.tone.join(','));
  if (filters.hue.length) params.set('hue', filters.hue.join(','));
  if (filters.temperature.length) params.set('temperature', filters.temperature.join(','));
  if (filters.tint.length) params.set('tint', filters.tint.join(','));
  if (page > 1) params.set('page', String(page));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function ColorsBrowseClient({
  tab,
  initialColors,
  totalCount,
  page,
  pageSize = COLOR_PAGE_SIZE,
  initialFilters,
}: ColorsBrowseClientProps) {
  const t = useTranslations('productionColors');
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<ColorFiltersState>(initialFilters);
  const [detailTcx, setDetailTcx] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const navigate = useCallback(
    (nextFilters: ColorFiltersState, nextPage: number) => {
      router.push(`${pathname}${buildQueryString(nextFilters, nextPage, tab)}`);
    },
    [pathname, router, tab]
  );

  const emptyMsg = tab === 'favorites' ? t('favoritesEmpty') : t('noResults');

  const colors = useMemo(() => initialColors, [initialColors]);

  const openDetail = (tcx: string) => {
    setDetailTcx(tcx);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <ColorsFilterBar
              filters={filters}
              onFiltersChange={(next) => {
                setFilters(next);
                navigate(next, 1);
              }}
              onSearchSubmit={() => navigate(filters, 1)}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <FilterSummaryBadges filters={filters} />
          <p className="text-sm text-muted-foreground">
            {totalCount.toLocaleString()} colors
          </p>
          <ColorSwatchGrid
            colors={colors}
            onSelect={openDetail}
            emptyMessage={emptyMsg}
          />
          {totalCount > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={(p) => navigate(filters, p)}
            />
          )}
        </div>
      </div>

      <PantoneColorDetailDialog
        tcx={detailTcx}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSelectSimilar={(tcx) => {
          setDetailTcx(tcx);
          setDetailOpen(true);
        }}
      />
    </div>
  );
}
