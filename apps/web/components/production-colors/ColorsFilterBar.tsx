'use client';

import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FILTER_SECTIONS,
  FILTER_OPTION_LABEL_KEYS,
  type FilterDimension,
} from '@/components/production-colors/color-filter-config';
import { cn } from '@/lib/utils';

export type ColorFiltersState = {
  search: string;
  tone: string[];
  hue: string[];
  temperature: string[];
  tint: string[];
};

export type FilterFacetCounts = Record<FilterDimension, Record<string, number>>;

type ColorsFilterBarProps = {
  filters: ColorFiltersState;
  facetCounts: FilterFacetCounts;
  onFiltersChange: (next: ColorFiltersState) => void;
  onSearchSubmit?: () => void;
};

function FilterChip({
  label,
  count,
  active,
  onClick,
  icon: Icon,
  hueSwatch,
  hueBorder,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  hueSwatch?: string;
  hueBorder?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary/30'
          : 'border-border bg-background text-foreground hover:bg-accent/50'
      )}
    >
      {hueSwatch ? (
        <span
          className={cn(
            'h-3.5 w-3.5 shrink-0 rounded-full',
            hueBorder && 'border border-border'
          )}
          style={{ backgroundColor: hueSwatch }}
          aria-hidden
        />
      ) : Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <span>{label}</span>
      <span className="font-normal text-muted-foreground">({count})</span>
    </button>
  );
}

function FilterSection({
  letter,
  title,
  subtitle,
  children,
}: {
  letter: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {letter}. {title}
        </p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ColorsFilterBar({
  filters,
  facetCounts,
  onFiltersChange,
  onSearchSubmit,
}: ColorsFilterBarProps) {
  const t = useTranslations('productionColors');

  const toggleTag = (dim: FilterDimension, value: string) => {
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

  const optionLabel = (dim: FilterDimension, labelKey: string) =>
    t(`filterOption.${dim}.${labelKey}` as Parameters<typeof t>[0]);

  const mainSections = FILTER_SECTIONS.filter((s) => !s.paired);
  const pairedSections = FILTER_SECTIONS.filter((s) => s.paired);

  return (
    <div className="space-y-5">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit?.();
        }}
      >
        <p className="text-xs font-medium text-muted-foreground">{t('searchLabel')}</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9 text-sm"
              placeholder={t('searchPlaceholder')}
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="h-9 shrink-0">
            {t('searchButton')}
          </Button>
        </div>
      </form>

      {mainSections.map((section) => (
        <FilterSection
          key={section.key}
          letter={section.letter}
          title={t(section.titleKey)}
          subtitle={t(section.subtitleKey)}
        >
          {section.chips.map((chip) => (
            <FilterChip
              key={chip.value}
              label={optionLabel(section.key, chip.labelKey)}
              count={facetCounts[section.key][chip.value] ?? 0}
              active={filters[section.key].includes(chip.value)}
              onClick={() => toggleTag(section.key, chip.value)}
              icon={chip.icon}
              hueSwatch={chip.hueSwatch}
              hueBorder={chip.hueBorder}
            />
          ))}
        </FilterSection>
      ))}

      <div className="grid grid-cols-2 gap-4">
        {pairedSections.map((section) => (
          <FilterSection
            key={section.key}
            letter={section.letter}
            title={t(section.titleKey)}
            subtitle={t(section.subtitleKey)}
          >
            {section.chips.map((chip) => (
              <FilterChip
                key={chip.value}
                label={optionLabel(section.key, chip.labelKey)}
                count={facetCounts[section.key][chip.value] ?? 0}
                active={filters[section.key].includes(chip.value)}
                onClick={() => toggleTag(section.key, chip.value)}
                icon={chip.icon}
              />
            ))}
          </FilterSection>
        ))}
      </div>

      <p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('filterLogicHint')}</span>
      </p>

      {hasFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="h-8 gap-1 px-0">
          <X className="h-3 w-3" />
          {t('clearFilters')}
        </Button>
      )}
    </div>
  );
}

export function FilterSummaryBadges({ filters }: { filters: ColorFiltersState }) {
  const t = useTranslations('productionColors');
  const dims: FilterDimension[] = ['tone', 'hue', 'temperature', 'tint'];
  const tags = dims.flatMap((dim) =>
    filters[dim].map((value) =>
      t(`filterOption.${dim}.${FILTER_OPTION_LABEL_KEYS[dim][value]}` as Parameters<typeof t>[0])
    )
  );
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
