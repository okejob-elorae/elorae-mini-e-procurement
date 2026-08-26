'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Info, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * One folder in a document archive.
 *
 * `pending` is the whole reason this shape beats a flat table: a folder that
 * still holds unfinished work wears a red dot, so the eye finds the work
 * without opening anything. An archive where nothing can be pending does not
 * need folders — a list will do.
 */
export type ArchiveFolder = {
  id: string;
  name: string;
  /** Documents inside. Zero renders as a dimmed, still-visible folder. */
  count: number;
  /** Short line under the name — usually a money total. */
  meta?: string | null;
  /** Documents inside that still need someone. Drives the red dot. */
  pending?: number;
  href: string;
};

export type DocumentArchiveProps = {
  folders: ArchiveFolder[];
  /** Summary line under the group title, e.g. "12 nota · 3 belum berfaktur". */
  summary?: string;
  groupTitle: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Explains what the red dot means and links to where that work is done. */
  hint?: React.ReactNode;
};

function FolderGlyph({ empty, pending }: { empty: boolean; pending: number }) {
  return (
    <span className="relative inline-flex">
      {/*
       * Drawn rather than an icon-font folder so the tab reads at this size and
       * the empty state can be a genuinely paler folder rather than a greyed
       * icon — matching how a physical archive looks when a slot is unused.
       */}
      <svg viewBox="0 0 48 40" className={cn('h-11 w-[3.3rem]', empty && 'opacity-45')} aria-hidden>
        <path
          d="M2 8a4 4 0 0 1 4-4h11.2a4 4 0 0 1 2.83 1.17L23 8H2Z"
          className={empty ? 'fill-muted-foreground/35' : 'fill-primary/70'}
        />
        <rect
          x="1"
          y="7"
          width="46"
          height="31"
          rx="4"
          className={empty ? 'fill-muted-foreground/20' : 'fill-primary/45'}
        />
      </svg>
      {pending > 0 && (
        <span
          className="absolute -bottom-0.5 right-1 h-3 w-3 rounded-full bg-destructive ring-2 ring-card"
          aria-hidden
        />
      )}
    </span>
  );
}

export function DocumentArchive({
  folders,
  summary,
  groupTitle,
  searchPlaceholder,
  emptyLabel,
  hint,
}: DocumentArchiveProps) {
  const t = useTranslations('archive');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{groupTitle}</h2>
              {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 text-sm"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
          ) : (
            <div className="anim-stagger grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {visible.map((folder) => {
                const empty = folder.count === 0;
                return (
                  <Link
                    key={folder.id}
                    href={folder.href}
                    className={cn(
                      'group flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-colors',
                      'hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                    )}
                  >
                    <span className="relative">
                      <FolderGlyph empty={empty} pending={folder.pending ?? 0} />
                      {folder.count > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-foreground px-1 py-0.5 text-[11px] font-semibold leading-none text-background tabular-nums">
                          {folder.count}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'line-clamp-2 text-sm font-medium',
                        empty && 'text-muted-foreground',
                      )}
                    >
                      {folder.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {empty ? emptyLabel : folder.meta}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {hint ? (
        <Card className="border-primary/25 bg-primary/[0.04]">
          <CardContent className="flex gap-2.5 py-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="leading-relaxed">{hint}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
