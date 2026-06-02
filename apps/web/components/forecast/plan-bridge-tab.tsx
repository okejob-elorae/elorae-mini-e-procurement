'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  applyPlanSuggestions,
  getItemCategoriesForForecast,
  getPlanYearsForForecast,
  suggestPlanTargets,
  type PlanTargetSuggestion,
} from '@/app/actions/forecast';
import { PERMISSIONS, hasPermission } from '@/lib/rbac';

interface PlanBridgeTabProps {
  forecastYear: number;
  permissions: string[];
}

type EditableSuggestion = PlanTargetSuggestion & {
  selected: boolean;
  adjustedQty: number;
  overrideItemCategoryId: string | null;
};

function actionBadge(action: string) {
  if (action === 'CREATE') return <Badge className="bg-green-600">{action}</Badge>;
  if (action === 'UPDATE') return <Badge className="bg-yellow-600 text-black">{action}</Badge>;
  return <Badge variant="secondary">{action}</Badge>;
}

export function ForecastPlanBridgeTab({ forecastYear, permissions }: PlanBridgeTabProps) {
  const t = useTranslations('forecast.bridge');
  const canApply =
    hasPermission(permissions, PERMISSIONS.FORECAST_MANAGE) &&
    hasPermission(permissions, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);

  const [planYears, setPlanYears] = useState<Array<{ id: string; year: number; isLocked: boolean }>>([]);
  const [planYearId, setPlanYearId] = useState('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [itemCategories, setItemCategories] = useState<
    Array<{ id: string; code: string | null; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    Promise.all([getPlanYearsForForecast(), getItemCategoriesForForecast()])
      .then(([years, categories]) => {
        setPlanYears(years);
        setItemCategories(categories);
        const match = years.find((y) => y.year === forecastYear);
        if (match) setPlanYearId(match.id);
        else if (years[0]) setPlanYearId(years[0].id);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load'));
  }, [forecastYear]);

  const handleGenerate = async () => {
    if (!planYearId) return;
    setLoading(true);
    try {
      const res = await suggestPlanTargets({ forecastYear, planYearId });
      if (!res.success || !res.suggestions) {
        toast.error(res.error ?? 'Failed to generate suggestions');
        return;
      }
      setSuggestions(
        res.suggestions.map((s) => ({
          ...s,
          selected: s.action !== 'SKIP',
          adjustedQty: s.forecastAnnual,
          overrideItemCategoryId: s.itemCategoryId,
        }))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const selected = suggestions.filter((s) => s.selected && s.action !== 'SKIP');
    const payload = selected
      .map((s) => {
        const itemCategoryId = s.overrideItemCategoryId ?? s.itemCategoryId;
        if (s.action === 'CREATE' && !itemCategoryId) return null;
        return {
          parentSku: s.parentSku,
          action: s.action as 'CREATE' | 'UPDATE',
          targetQty: s.adjustedQty,
          itemCategoryId: itemCategoryId ?? undefined,
          itemId: s.itemId ?? undefined,
          categoryId: s.existingCategoryId ?? undefined,
        };
      })
      .filter(Boolean) as Parameters<typeof applyPlanSuggestions>[0]['suggestions'];

    if (payload.length === 0) {
      toast.error('No valid suggestions selected');
      return;
    }

    setApplying(true);
    try {
      const res = await applyPlanSuggestions({ planYearId, suggestions: payload });
      if (!res.success) {
        toast.error(res.error ?? 'Apply failed');
        return;
      }
      const year = planYears.find((y) => y.id === planYearId)?.year ?? forecastYear;
      toast.success(
        t('applied', { count: (res.created ?? 0) + (res.updated ?? 0), year: String(year) })
      );
      await handleGenerate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = suggestions.filter((s) => s.selected && s.action !== 'SKIP').length;
  const planYear = planYears.find((y) => y.id === planYearId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('planYear')}</label>
          <Select value={planYearId} onValueChange={setPlanYearId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Plan year" />
            </SelectTrigger>
            <SelectContent>
              {planYears.map((y) => (
                <SelectItem key={y.id} value={y.id} disabled={y.isLocked}>
                  {y.year}
                  {y.isLocked ? ' (locked)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canApply && (
          <Button onClick={handleGenerate} disabled={loading || !planYearId}>
            {loading ? '...' : t('generate')}
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{t('note')}</p>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Article</TableHead>
                <TableHead>Item Category</TableHead>
                <TableHead className="text-right">{t('forecast')}</TableHead>
                <TableHead className="text-right">{t('planNow')}</TableHead>
                <TableHead className="text-right">{t('delta')}</TableHead>
                <TableHead>{t('action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((s, idx) => {
                const effectiveCategoryId = s.overrideItemCategoryId ?? s.itemCategoryId;
                const canApplyRow =
                  s.action === 'UPDATE' ||
                  (s.action === 'CREATE' && !!effectiveCategoryId);
                return (
                  <TableRow key={s.parentSku}>
                    <TableCell>
                      <Checkbox
                        checked={s.selected}
                        disabled={s.action === 'SKIP'}
                        onCheckedChange={(checked) => {
                          setSuggestions((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, selected: !!checked } : row
                            )
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.productName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.parentSku}</div>
                    </TableCell>
                    <TableCell>
                      {s.action === 'CREATE' && !s.canCreate ?
                        <Select
                          value={s.overrideItemCategoryId ?? ''}
                          onValueChange={(v) => {
                            setSuggestions((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, overrideItemCategoryId: v } : row
                              )
                            );
                          }}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={t('selectCategory')} />
                          </SelectTrigger>
                          <SelectContent>
                            {itemCategories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.code ? `${c.code} — ` : ''}
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      : <span className="text-sm">
                          {s.itemCategoryCode ?? '—'} {s.itemCategoryName ?? ''}
                        </span>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="h-8 w-24 ml-auto"
                        value={s.adjustedQty}
                        disabled={s.action === 'SKIP'}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setSuggestions((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, adjustedQty: v } : row
                            )
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {s.existingPlanTarget != null ?
                        s.existingPlanTarget.toLocaleString()
                      : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {(s.adjustedQty - (s.existingPlanTarget ?? 0)).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {actionBadge(s.action)}
                      {s.action === 'CREATE' && !canApplyRow && (
                        <p className="text-xs text-destructive mt-1">{t('selectCategory')}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {suggestions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Generate suggestions to review plan targets.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canApply && suggestions.length > 0 && (
        <div className="flex items-center gap-4">
          <Button onClick={handleApply} disabled={applying || selectedCount === 0 || planYear?.isLocked}>
            {applying ? '...' : t('apply')} ({selectedCount})
          </Button>
          {planYear && (
            <Button variant="link" asChild>
              <Link href="/backoffice/production/planning">Open Plan Kerja {planYear.year}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
