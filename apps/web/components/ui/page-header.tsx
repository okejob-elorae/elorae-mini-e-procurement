import type { ReactNode } from 'react';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { cn } from '@/lib/utils';

/**
 * Standard head of a backoffice page: title, an ⓘ beside it, the page's data
 * line (`meta`) and its actions.
 *
 * Explanations are NOT printed on the page (owner, 2026-10-05: "saya tidak
 * suka banyak keterangan"). What a page is for, and what each of its cards
 * means, lives in its entry in `lib/bantuan/daftar/` — the ⓘ opens that entry,
 * and `/backoffice/bantuan` lists every page. `lib/bantuan/cakupan.test.ts`
 * fails when a page has no entry.
 *
 * `description` is only the ⓘ's fallback for a page without an entry; it is
 * never rendered on screen. Data about the record on screen (store, date,
 * document number, a count) goes in `meta`, which always shows.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <TombolBantuan judul={title} isi={description} />
        </div>
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
