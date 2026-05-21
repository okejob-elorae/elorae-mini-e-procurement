'use client';

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
  const start = totalCount != null && pageSize != null ? (page - 1) * pageSize + 1 : null;
  const end =
    totalCount != null && pageSize != null
      ? Math.min(page * pageSize, totalCount)
      : null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
      {totalCount != null && pageSize != null && start != null && end != null && (
        <p className="text-sm text-muted-foreground order-2 sm:order-1">
          Showing {start}–{end} of {totalCount}
        </p>
      )}
      <div className="flex items-center gap-2 order-1 sm:order-2">
        <p className="text-sm text-muted-foreground whitespace-nowrap">
          Page {page} of {totalPages}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
