import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Semantic tones for state, deliberately independent of the Pantone theme
 * colour.
 *
 * The accent hue is a preference — a user picks it and it changes nothing about
 * what the screen means. These five do the opposite: green has to mean settled
 * and red has to mean broken no matter which theme is loaded, or the operator
 * has to read every pill instead of scanning the column. So they are fixed
 * literals rather than tokens derived from --primary.
 */
export type StatusTone = 'settled' | 'progress' | 'waiting' | 'attention' | 'inactive';

const TONE_CLASS: Record<StatusTone, string> = {
  settled:
    'bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300 dark:ring-emerald-400/25',
  progress:
    'bg-sky-500/12 text-sky-700 ring-sky-600/25 dark:text-sky-300 dark:ring-sky-400/25',
  waiting:
    'bg-amber-500/14 text-amber-800 ring-amber-600/30 dark:text-amber-300 dark:ring-amber-400/25',
  attention:
    'bg-red-500/12 text-red-700 ring-red-600/25 dark:text-red-300 dark:ring-red-400/25',
  inactive:
    'bg-muted text-muted-foreground ring-border',
};

const DOT_CLASS: Record<StatusTone, string> = {
  settled: 'bg-emerald-600 dark:bg-emerald-400',
  progress: 'bg-sky-600 dark:bg-sky-400',
  waiting: 'bg-amber-600 dark:bg-amber-400',
  attention: 'bg-red-600 dark:bg-red-400',
  inactive: 'bg-muted-foreground/60',
};

export function StatusPill({
  tone,
  children,
  detail,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  /**
   * The line that turns a label into a fact: "lewat 28 hari" under a due date.
   * A state without its consequence forces the reader to work it out.
   */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-col items-start gap-0.5', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
          TONE_CLASS[tone],
        )}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[tone])} />
        {children}
      </span>
      {detail ? (
        <span
          className={cn(
            'pl-1 text-[11px] leading-tight',
            tone === 'attention'
              ? 'text-red-600 dark:text-red-400'
              : 'text-muted-foreground',
          )}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}
