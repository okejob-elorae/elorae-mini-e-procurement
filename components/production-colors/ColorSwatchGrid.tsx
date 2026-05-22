'use client';

import { useTranslations } from 'next-intl';
import { FavoriteButton } from '@/components/production-colors/FavoriteButton';
import type { PantoneSwatch } from '@/components/production-colors/types';
import { cn } from '@/lib/utils';

type ColorSwatchGridProps = {
  colors: PantoneSwatch[];
  onSelect: (tcx: string) => void;
  emptyMessage?: string;
};

export function ColorSwatchGrid({ colors, onSelect, emptyMessage }: ColorSwatchGridProps) {
  const t = useTranslations('productionColors');

  if (!colors.length) {
    return (
      <p className="text-center text-muted-foreground py-12">
        {emptyMessage ?? t('noResults')}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {colors.map((color) => (
        <div
          key={color.tcx}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(color.tcx)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(color.tcx);
            }
          }}
          className={cn(
            'group relative rounded-lg border bg-card text-left overflow-hidden cursor-pointer',
            'hover:ring-2 hover:ring-primary/50 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          )}
        >
          <div
            className="aspect-square w-full"
            style={{ backgroundColor: color.hex }}
          />
          <div className="p-2 space-y-0.5 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <p className="text-xs font-mono font-medium truncate">{color.tcx}</p>
              <FavoriteButton
                tcx={color.tcx}
                initialFavorited={!!color.isFavorite}
                className="h-7 w-7 -mr-1"
              />
            </div>
            <p className="text-xs text-muted-foreground truncate">{color.name}</p>
            {color.groupName && (
              <p className="text-[10px] text-muted-foreground truncate">{color.groupName}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
