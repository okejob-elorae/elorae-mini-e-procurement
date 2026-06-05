'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import type { ForecastResultDetail } from '@/app/actions/forecast';
import { MonthlyForecastTable } from './monthly-forecast-row';

interface ArticlesTabProps {
  results: ForecastResultDetail[];
  selectedSku: string | null;
  onSelectSku: (sku: string | null) => void;
}

export function ForecastArticlesTab({ results, selectedSku, onSelectSku }: ArticlesTabProps) {
  const t = useTranslations('forecast');

  const options = useMemo(
    () =>
      results.map((r) => ({
        value: r.parentSku,
        label: `${r.parentSku} — ${r.productName}`,
      })),
    [results]
  );

  const selected = results.find((r) => r.parentSku === selectedSku) ?? results[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <SearchableCombobox
          options={options}
          value={selected?.parentSku ?? ''}
          onValueChange={(v) => onSelectSku(v || null)}
          placeholder="Select article..."
          emptyMessage="No articles"
        />
      </div>

      {selected ?
        <>
          <div className="flex flex-wrap gap-2">
            <Badge>{selected.abcClass}{selected.xyzClass}</Badge>
            <span className="text-sm text-muted-foreground">
              CV: {selected.coefficientOfVariation.toFixed(2)} · Base rate:{' '}
              {Math.round(selected.avgMonthlyDemand).toLocaleString()}/mo
            </span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('results.annual')}: {selected.annualForecast.toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyForecastTable
                monthlyForecast={selected.monthlyForecast}
                seasonalIndices={selected.seasonalIndices}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historical summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-3">
              <div>
                <span className="text-muted-foreground">Total historical qty</span>
                <p className="font-medium">{selected.totalHistoricalQty.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total revenue</span>
                <p className="font-medium">{selected.totalHistoricalRevenue.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Plan target</span>
                <p className="font-medium">
                  {selected.planTarget != null ?
                    selected.planTarget.toLocaleString()
                  : t('results.noPlan')}
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      : <p className="text-muted-foreground">Run forecast to see article details.</p>}
    </div>
  );
}
