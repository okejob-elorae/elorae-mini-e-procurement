'use client';

import { useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Lightbulb, Search, SlidersHorizontal, X } from 'lucide-react';
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
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  /*
   * Only search and hue stay on screen.
   *
   * All four dimensions used to be expanded at once — 25 chips and four
   * headings, about 750px, so the colour grid the page exists for started
   * below the fold. Hue earns its place because picking a colour by its family
   * is how people actually browse a swatch library, and the chips carry the
   * swatch itself. Tone, temperature and tint are refinements: useful, but not
   * worth the first screen.
   *
   * Active refinements stay visible as removable chips whether the drawer is
   * open or shut, so collapsing never hides state.
   */
  const hueSection = FILTER_SECTIONS.find((sec) => sec.key === 'hue');
  const advancedSections = FILTER_SECTIONS.filter((sec) => sec.key !== 'hue');
  const advancedCount =
    filters.tone.length + filters.temperature.length + filters.tint.length;

  return (
    <div className="space-y-3">
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
            className="h-9 pl-9 text-sm"
            placeholder={t('searchPlaceholder')}
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" className="h-9 shrink-0">
          {t('searchButton')}
        </Button>
        <Button
          type="button"
          variant={advancedCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-9 shrink-0 gap-1.5"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {showAdvanced ? t('hideFilters') : t('moreFilters')}
          </span>
          {advancedCount > 0 && (
            <span className="rounded-full bg-background/25 px-1.5 text-[11px] font-semibold tabular-nums">
              {advancedCount}
            </span>
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')}
            aria-hidden
          />
        </Button>
      </form>

      {hueSection && (
        <div className="flex flex-wrap gap-1.5">
          {hueSection.chips.map((chip) => (
            <FilterChip
              key={chip.value}
              label={optionLabel('hue', chip.labelKey)}
              count={facetCounts.hue[chip.value] ?? 0}
              active={filters.hue.includes(chip.value)}
              onClick={() => toggleTag('hue', chip.value)}
              icon={chip.icon}
              hueSwatch={chip.hueSwatch}
              hueBorder={chip.hueBorder}
            />
          ))}
        </div>
      )}

      {showAdvanced && (
        <div className="anim-fade space-y-4 rounded-lg border bg-muted/30 p-4">
          {advancedSections.map((section) => (
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
          <p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('filterLogicHint')}</span>
          </p>
        </div>
      )}

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(['tone', 'hue', 'temperature', 'tint'] as FilterDimension[]).flatMap((dim) =>
            filters[dim].map((value) => {
              const label = optionLabel(dim, FILTER_OPTION_LABEL_KEYS[dim][value]);
              return (
                <button
                  key={`${dim}-${value}`}
                  type="button"
                  onClick={() => toggleTag(dim, value)}
                  aria-label={t('removeFilter', { name: label })}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-inset ring-primary/25 transition-colors hover:bg-primary/20"
                >
                  {label}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              );
            }),
          )}
          <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="h-6 px-2 text-xs">
            {t('clearFilters')}
          </Button>
        </div>
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
