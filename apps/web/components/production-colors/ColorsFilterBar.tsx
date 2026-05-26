'use client';

import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_FILTER_OPTIONS } from '@elorae/db';
import { cn } from '@/lib/utils';

export type ColorFiltersState = {
  search: string;
  tone: string[];
  hue: string[];
  temperature: string[];
  tint: string[];
};

type ColorsFilterBarProps = {
  filters: ColorFiltersState;
  onFiltersChange: (next: ColorFiltersState) => void;
  onSearchSubmit?: () => void;
};

const DIMENSIONS = [
  { key: 'tone' as const, labelKey: 'filterTone' },
  { key: 'hue' as const, labelKey: 'filterHue' },
  { key: 'temperature' as const, labelKey: 'filterTemperature' },
  { key: 'tint' as const, labelKey: 'filterTint' },
];

export function ColorsFilterBar({
  filters,
  onFiltersChange,
  onSearchSubmit,
}: ColorsFilterBarProps) {
  const t = useTranslations('productionColors');

  const toggleTag = (dim: keyof Pick<ColorFiltersState, 'tone' | 'hue' | 'temperature' | 'tint'>, value: string) => {
    const current = filters[dim];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [dim]: next });
  };

  const hasFilters =
    filters.tone.length > 0 ||
    filters.hue.length > 0 ||
    filters.temperature.length > 0 ||
    filters.tint.length > 0;

  const clearAll = () => {
    onFiltersChange({
      search: filters.search,
      tone: [],
      hue: [],
      temperature: [],
      tint: [],
    });
  };

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit?.();
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t('searchPlaceholder')}
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {DIMENSIONS.map(({ key, labelKey }) => (
        <div key={key} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t(labelKey)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_FILTER_OPTIONS[key].map((opt) => {
              const active = filters[key].includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleTag(key, opt)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {hasFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="gap-1">
          <X className="h-3 w-3" />
          {t('clearFilters')}
        </Button>
      )}
    </div>
  );
}

export function FilterSummaryBadges({ filters }: { filters: ColorFiltersState }) {
  const tags = [...filters.tone, ...filters.hue, ...filters.temperature, ...filters.tint];
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-xs">
          {tag}
        </Badge>
      ))}
    </div>
  );
}
