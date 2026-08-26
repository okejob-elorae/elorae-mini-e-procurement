import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard head of a backoffice page.
 *
 * `description` is not decoration and not a feature blurb. It says what the
 * screen is for, who does the work, and when — "Tanda terima dari toko, dasar
 * janji bayar. Dibuat sales dari HP saat keliling." A new operator should be
 * able to read one sentence and know whether this screen is theirs.
 *
 * `meta` carries the one figure that frames the page (a total, a count) so it
 * sits with the title instead of hiding in a card below the fold.
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
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
