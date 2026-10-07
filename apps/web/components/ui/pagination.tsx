'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  /** 1-based current page */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Called when user requests a new page */
  onPageChange: (page: number) => void;
  /** Optional: total item count for "Showing x–y of total" */
  totalCount?: number;
  /** Optional: page size for summary (used with totalCount) */
  pageSize?: number;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  totalCount,
  pageSize,
}: PaginationProps) {
  const t = useTranslations('pagination');
  const start = totalCount != null && pageSize != null ? (page - 1) * pageSize + 1 : null;
  const end =
    totalCount != null && pageSize != null
      ? Math.min(page * pageSize, totalCount)
      : null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
      {totalCount != null && pageSize != null && start != null && end != null && (
        <p className="text-sm text-muted-foreground order-2 sm:order-1">
          {t('showing', { start, end, total: totalCount })}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2 order-1 sm:order-2">
        <p className="text-sm text-muted-foreground whitespace-nowrap">
          {t('page', { page, total: totalPages })}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label={t('previousAria')}
        >
          <ChevronLeft className="h-4 w-4" />
          {/* Label disembunyikan di layar sempit supaya tombol tidak keluar dari kartunya (375 px). */}
          <span className="hidden sm:inline">{t('previous')}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label={t('nextAria')}
        >
          <span className="hidden sm:inline">{t('next')}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
