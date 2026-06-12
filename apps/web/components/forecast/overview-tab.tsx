'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { runForecast, type ForecastResultDetail } from '@/app/actions/forecast';
import { MonthlyForecastRow } from './monthly-forecast-row';
import { PERMISSIONS, hasPermission } from '@/lib/rbac';

const PAGE_SIZE = 25;

const ABC_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };
const XYZ_ORDER: Record<string, number> = { X: 0, Y: 1, Z: 2 };

type SortKey =
  | 'parentSku'
  | 'productName'
  | 'abcClass'
  | 'xyzClass'
  | 'avgMonthlyDemand'
  | 'annualForecast'
  | 'planTarget';

type SortDir = 'asc' | 'desc';

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

function compareRows(
  a: ForecastResultDetail,
  b: ForecastResultDetail,
  key: SortKey,
  dir: SortDir
): number {
  let cmp = 0;

  switch (key) {
    case 'parentSku':
      cmp = a.parentSku.localeCompare(b.parentSku);
      break;
    case 'productName':
      cmp = a.productName.localeCompare(b.productName);
      break;
    case 'abcClass':
      cmp = (ABC_ORDER[a.abcClass] ?? 99) - (ABC_ORDER[b.abcClass] ?? 99);
      break;
    case 'xyzClass':
      cmp = (XYZ_ORDER[a.xyzClass] ?? 99) - (XYZ_ORDER[b.xyzClass] ?? 99);
      break;
    case 'avgMonthlyDemand':
      cmp = a.avgMonthlyDemand - b.avgMonthlyDemand;
      break;
    case 'annualForecast':
      cmp = a.annualForecast - b.annualForecast;
      break;
    case 'planTarget': {
      const aVal = a.planTarget;
      const bVal = b.planTarget;
      if (aVal == null && bVal == null) cmp = 0;
      else if (aVal == null) cmp = 1;
      else if (bVal == null) cmp = -1;
      else cmp = aVal - bVal;
      break;
    }
  }

  return dir === 'asc' ? cmp : -cmp;
}

interface SortableHeadProps {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortableHead({
  label,
  sortKey,
  activeSort,
  sortDir,
  onSort,
  className,
}: SortableHeadProps) {
  const active = activeSort === sortKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={className}>
      <div className={className?.includes('text-right') ? 'flex justify-end' : undefined}>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
          onClick={() => onSort(sortKey)}
        >
          {label}
          <Icon
            className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground'}`}
          />
        </button>
      </div>
    </TableHead>
  );
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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('annualForecast');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const canManage = hasPermission(permissions, PERMISSIONS.FORECAST_MANAGE);

  const totalAnnual = results.reduce((s, r) => s + r.annualForecast, 0);
  const avgMonthly = results.length > 0 ? Math.round(totalAnnual / 12 / results.length) : 0;

  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      (r) =>
        r.parentSku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q)
    );
  }, [results, searchQuery]);

  const sortedResults = useMemo(() => {
    const copy = [...filteredResults];
    copy.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return copy;
  }, [filteredResults, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortKey, sortDir]);

  const pagedResults = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedResults.slice(start, start + PAGE_SIZE);
  }, [page, sortedResults]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'parentSku' || key === 'productName' ? 'asc' : 'desc');
    }
  };

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
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t('results.summaryTitle')}</CardTitle>
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('results.searchPlaceholder')}
            className="max-w-sm"
            aria-label={t('results.searchPlaceholder')}
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <SortableHead
                  label={t('matrixModal.parentSku')}
                  sortKey="parentSku"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableHead
                  label={t('matrixModal.product')}
                  sortKey="productName"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableHead
                  label={t('results.abc')}
                  sortKey="abcClass"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableHead
                  label={t('results.xyz')}
                  sortKey="xyzClass"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableHead
                  label={t('matrixModal.avgMonthly')}
                  sortKey="avgMonthlyDemand"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHead
                  label={t('matrixModal.annual')}
                  sortKey="annualForecast"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHead
                  label={t('results.planTarget')}
                  sortKey="planTarget"
                  activeSort={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedResults.map((row, idx) => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedSku(expandedSku === row.parentSku ? null : row.parentSku)
                    }
                  >
                    <TableCell>{(page - 1) * PAGE_SIZE + idx + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{row.parentSku}</TableCell>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>
                      <Badge className={abcBadgeClass(row.abcClass)}>{row.abcClass}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={xyzBadgeClass(row.xyzClass)}>{row.xyzClass}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.round(row.avgMonthlyDemand).toLocaleString()}
                    </TableCell>
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
                      monthlyForecast={row.monthlyForecast}
                      seasonalIndices={row.seasonalIndices}
                    />
                  )}
                </Fragment>
              ))}
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {t('results.empty')}
                  </TableCell>
                </TableRow>
              )}
              {results.length > 0 && sortedResults.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {t('results.noMatch')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {sortedResults.length > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              totalCount={sortedResults.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
