'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ForecastOverviewTab } from '@/components/forecast/overview-tab';
import { ForecastArticlesTab } from '@/components/forecast/articles-tab';
import { ForecastAbcMatrixTab } from '@/components/forecast/abc-matrix-tab';
import { ForecastPlanBridgeTab } from '@/components/forecast/plan-bridge-tab';
import { ForecastConfigModal } from '@/components/forecast/config-modal';
import {
  getDataCoverage,
  getForecastConfig,
  getForecastResults,
  type ForecastResultDetail,
} from '@/app/actions/forecast';

const TABS = ['overview', 'articles', 'abc', 'plan-bridge'] as const;

function yearOptions(): number[] {
  const current = new Date().getFullYear();
  return [current - 2, current - 1, current];
}

export function ForecastPageClient() {
  const t = useTranslations('forecast');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();

  const tabParam = searchParams.get('tab') ?? 'overview';
  const activeTab = TABS.includes(tabParam as (typeof TABS)[number]) ? tabParam : 'overview';
  const yearParam = searchParams.get('year');
  const initialYear = yearParam ? Number(yearParam) : new Date().getFullYear();

  const [year, setYear] = useState(initialYear);
  const [results, setResults] = useState<ForecastResultDetail[]>([]);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getForecastConfig>>>(null);
  const [coverageMonths, setCoverageMonths] = useState(0);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [forecastResults, forecastConfig, coverage] = await Promise.all([
        getForecastResults(year),
        getForecastConfig(year),
        getDataCoverage(),
      ]);
      setResults(forecastResults);
      setConfig(forecastConfig);
      setCoverageMonths(coverage.totalMonthsCovered);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load forecast');
    }
  }, [year]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    params.set('year', String(year));
    router.replace(`/backoffice/forecast?${params.toString()}`);
  };

  const handleYearChange = (y: string) => {
    const next = Number(y);
    setYear(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', String(next));
    router.replace(`/backoffice/forecast?${params.toString()}`);
  };

  const configSummary =
    config ?
      `Lookback ${config.lookbackMonths} mo · Growth ${Number(config.growthFactorPercent)}% · Decay ${Number(config.weightDecay)}`
    : 'Default config (run forecast to create)';

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('config.year')}</span>
          <Select value={String(year)} onValueChange={handleYearChange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions().map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="articles">{t('tabs.articles')}</TabsTrigger>
          <TabsTrigger value="abc">{t('tabs.abc')}</TabsTrigger>
          <TabsTrigger value="plan-bridge">{t('tabs.planBridge')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <ForecastOverviewTab
            year={year}
            results={results}
            configSummary={configSummary}
            coverageMonths={coverageMonths}
            permissions={session?.user?.permissions ?? []}
            onRefresh={refresh}
            onEditConfig={() => setConfigOpen(true)}
          />
        </TabsContent>

        <TabsContent value="articles" className="mt-6">
          <ForecastArticlesTab
            results={results}
            selectedSku={selectedSku ?? searchParams.get('sku')}
            onSelectSku={setSelectedSku}
          />
        </TabsContent>

        <TabsContent value="abc" className="mt-6">
          <ForecastAbcMatrixTab
            results={results}
            onSelectArticle={(sku) => {
              setSelectedSku(sku);
              setTab('articles');
            }}
          />
        </TabsContent>

        <TabsContent value="plan-bridge" className="mt-6">
          <ForecastPlanBridgeTab
            forecastYear={year}
            permissions={session?.user?.permissions ?? []}
          />
        </TabsContent>
      </Tabs>

      <ForecastConfigModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        year={year}
        initial={
          config ?
            {
              growthFactorPercent: Number(config.growthFactorPercent),
              lookbackMonths: config.lookbackMonths,
              weightDecay: Number(config.weightDecay),
              notes: config.notes,
            }
          : null
        }
        onSaved={refresh}
      />
    </div>
  );
}
