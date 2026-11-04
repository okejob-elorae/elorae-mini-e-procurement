'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderGlyph } from './FolderGlyph';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
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
  /**
   * Tautan ke tempat pekerjaan yang menggantung dikerjakan. Arti titik
   * merahnya ada di Bantuan, bukan di layar.
   */
  hint?: React.ReactNode;
};




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
                aria-label={searchPlaceholder}
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

      {hint ? <div className="text-sm">{hint}</div> : null}
    </div>
  );
}
