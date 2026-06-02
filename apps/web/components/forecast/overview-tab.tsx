'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { runForecast, type ForecastResultDetail } from '@/app/actions/forecast';
import { MonthlyForecastRow } from './monthly-forecast-row';
import { PERMISSIONS, hasPermission } from '@/lib/rbac';

function abcBadgeClass(abc: string) {
  if (abc === 'A') return 'bg-green-600';
  if (abc === 'B') return 'bg-yellow-600 text-black';
  return 'bg-muted text-muted-foreground';
}

function xyzBadgeClass(xyz: string) {
  if (xyz === 'X') return 'bg-blue-600';
  if (xyz === 'Y') return 'bg-orange-600';
  return 'bg-red-600';
}

interface OverviewTabProps {
  year: number;
  results: ForecastResultDetail[];
  configSummary: string;
  coverageMonths: number;
  permissions: string[];
  onRefresh: () => void;
  onEditConfig: () => void;
}

export function ForecastOverviewTab({
  year,
  results,
  configSummary,
  coverageMonths,
  permissions,
  onRefresh,
  onEditConfig,
}: OverviewTabProps) {
  const t = useTranslations('forecast');
  const [running, setRunning] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const canManage = hasPermission(permissions, PERMISSIONS.FORECAST_MANAGE);

  const totalAnnual = results.reduce((s, r) => s + r.annualForecast, 0);
  const avgMonthly = results.length > 0 ? Math.round(totalAnnual / 12 / results.length) : 0;

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await runForecast({ targetYear: year });
      if (!res.success) {
        toast.error(res.error ?? 'Forecast failed');
        return;
      }
      toast.success(`Forecast complete: ${res.articleCount ?? 0} articles`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Forecast failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{configSummary}</p>
        {canManage && (
          <>
            <Button variant="outline" size="sm" onClick={onEditConfig}>
              {t('config.editConfig')}
            </Button>
            <Button size="sm" onClick={handleRun} disabled={running}>
              {running ? t('config.running') : t('config.run')}
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/backoffice/forecast/import">{t('import.goToImport')}</Link>
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('results.totalArticles')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{results.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('results.annual')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalAnnual.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('results.avgMonthly')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{avgMonthly.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('results.dataCoverage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {coverageMonths} {t('results.months')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Forecast Summary</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Parent SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>ABC</TableHead>
                <TableHead>XYZ</TableHead>
                <TableHead className="text-right">Avg/mo</TableHead>
                <TableHead className="text-right">Annual</TableHead>
                <TableHead className="text-right">{t('results.planTarget')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row, idx) => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedSku(expandedSku === row.parentSku ? null : row.parentSku)
                    }
                  >
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{row.parentSku}</TableCell>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>
                      <Badge className={abcBadgeClass(row.abcClass)}>{row.abcClass}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={xyzBadgeClass(row.xyzClass)}>{row.xyzClass}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{Math.round(row.avgMonthlyDemand).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.annualForecast.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.planTarget != null ? row.planTarget.toLocaleString() : t('results.noPlan')}
                    </TableCell>
                  </TableRow>
                  {expandedSku === row.parentSku && (
                    <MonthlyForecastRow
                      key={`${row.id}-detail`}
                      parentSku={row.parentSku}
                      productName={row.productName}
                      monthlyForecast={row.monthlyForecast}
                      seasonalIndices={row.seasonalIndices}
                    />
                )}
              </Fragment>
            ))}
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No forecast results. Import sales data and run forecast.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
