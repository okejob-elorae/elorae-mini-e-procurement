import type { ListPantoneFilters } from './queries';
import type { ColorFiltersState } from '@/components/production-colors/ColorsFilterBar';

export function parseColorSearchParams(
  sp: Record<string, string | string[] | undefined>
): {
  search: string;
  filters: ListPantoneFilters;
  page: number;
  filterState: ColorFiltersState;
} {
  const get = (key: string) => {
    const v = sp[key];
    return typeof v === 'string' ? v : undefined;
  };
  const parseList = (key: string): string[] => {
    const raw = get(key);
    if (!raw?.trim()) return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  };

  const search = get('search')?.trim() ?? '';
  const tone = parseList('tone');
  const hue = parseList('hue');
  const temperature = parseList('temperature');
  const tint = parseList('tint');

  return {
    search,
    filters: {
      search: search || undefined,
      tone: tone.length ? tone : undefined,
      hue: hue.length ? hue : undefined,
      temperature: temperature.length ? temperature : undefined,
      tint: tint.length ? tint : undefined,
    },
    page: Math.max(1, parseInt(get('page') ?? '1', 10) || 1),
    filterState: { search, tone, hue, temperature, tint },
  };
}

export function buildColorSearchParams(
  search: string,
  filters: ListPantoneFilters,
  page: number
): string {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  const dims = ['tone', 'hue', 'temperature', 'tint'] as const;
  for (const d of dims) {
    const vals = filters[d];
    if (vals?.length) params.set(d, vals.join(','));
  }
  if (page > 1) params.set('page', String(page));
  const q = params.toString();
  return q ? `?${q}` : '';
}
