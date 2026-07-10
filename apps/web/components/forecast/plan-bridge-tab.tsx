"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyPlanSuggestions,
  getItemCategoriesForForecast,
  getPlanYearsForForecast,
  suggestPlanTargets,
  type PlanTargetSuggestion,
} from "@/app/actions/forecast";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { cn } from "@/lib/utils";

interface PlanBridgeTabProps {
  forecastYear: number;
  permissions: string[];
}

type BridgePlanYear = {
  id: string;
  year: number;
  isLocked: boolean;
  status: "DRAFT" | "ACTIVE";
};

function isBridgeTargetYear(year: BridgePlanYear): boolean {
  return !year.isLocked && year.status === "DRAFT";
}

function pickDefaultPlanYearId(years: BridgePlanYear[], forecastYear: number): string {
  const editable = years.filter(isBridgeTargetYear);
  const match = editable.find((y) => y.year === forecastYear);
  return match?.id ?? editable[0]?.id ?? "";
}

type EditableSuggestion = PlanTargetSuggestion & {
  selected: boolean;
  adjustedQty: number;
  overrideItemCategoryId: string | null;
};

function actionBadge(action: string) {
  if (action === "CREATE") return <Badge className="bg-green-600">{action}</Badge>;
  if (action === "UPDATE") return <Badge className="bg-yellow-600 text-black">{action}</Badge>;
  return <Badge variant="secondary">{action}</Badge>;
}

function sortSuggestions(rows: EditableSuggestion[]): EditableSuggestion[] {
  return [...rows].sort((a, b) => {
    const mappedA = a.itemId ? 0 : 1;
    const mappedB = b.itemId ? 0 : 1;
    if (mappedA !== mappedB) return mappedA - mappedB;

    const catA = a.itemCategoryName ?? a.itemCategoryCode ?? "";
    const catB = b.itemCategoryName ?? b.itemCategoryCode ?? "";
    if (catA !== catB) return catA.localeCompare(catB);
    return a.parentSku.localeCompare(b.parentSku);
  });
}

function isSuggestionRowEnabled(s: EditableSuggestion): boolean {
  return Boolean(s.itemId);
}

export function ForecastPlanBridgeTab({ forecastYear, permissions }: PlanBridgeTabProps) {
  const t = useTranslations("forecast.bridge");
  const canApply =
    hasPermission(permissions, PERMISSIONS.FORECAST_MANAGE) &&
    hasPermission(permissions, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);

  const [planYears, setPlanYears] = useState<BridgePlanYear[]>([]);
  const [planYearId, setPlanYearId] = useState("");
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [itemCategories, setItemCategories] = useState<
    Array<{ id: string; code: string | null; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const sortedSuggestions = useMemo(() => sortSuggestions(suggestions), [suggestions]);

  useEffect(() => {
    Promise.all([getPlanYearsForForecast(), getItemCategoriesForForecast()])
      .then(([years, categories]) => {
        setPlanYears(years);
        setItemCategories(categories);
        setPlanYearId(pickDefaultPlanYearId(years, forecastYear));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load"));
  }, [forecastYear]);

  const handleGenerate = async () => {
    if (!planYearId) return;
    setLoading(true);
    try {
      const res = await suggestPlanTargets({ forecastYear, planYearId });
      if (!res.success || !res.suggestions) {
        toast.error(res.error ?? "Failed to generate suggestions");
        return;
      }
      setSuggestions(
        res.suggestions.map((s) => ({
          ...s,
          selected: s.action !== "SKIP" && Boolean(s.itemId),
          adjustedQty: s.forecastAnnual,
          overrideItemCategoryId: s.itemCategoryId,
        }))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const payload = suggestions
      .filter((s) => s.selected && s.action !== "SKIP")
      .map((s) => {
        const itemCategoryId = s.overrideItemCategoryId ?? s.itemCategoryId;
        if (!itemCategoryId || !s.itemId) return null;
        return {
          parentSku: s.parentSku,
          adjustedQty: s.adjustedQty,
          itemCategoryId,
          itemId: s.itemId,
          action: s.action,
        };
      })
      .filter(Boolean) as Parameters<typeof applyPlanSuggestions>[0]["suggestions"];

    if (payload.length === 0) {
      toast.error("No valid suggestions selected");
      return;
    }

    setApplying(true);
    try {
      const res = await applyPlanSuggestions({ planYearId, suggestions: payload });
      const year = planYears.find((y) => y.id === planYearId)?.year ?? forecastYear;
      const count = (res.created ?? 0) + (res.updated ?? 0);

      if (!res.success && count === 0) {
        toast.error(res.error ?? res.errors?.[0]?.message ?? "Apply failed");
        return;
      }

      if (res.errors?.length) {
        toast.warning(
          t("appliedPartial", { count: String(count), skipped: String(res.skipped ?? 0), year: String(year) })
        );
        const firstError = res.errors[0]?.message;
        if (firstError) toast.error(firstError);
      } else {
        toast.success(t("applied", { count: String(count), year: String(year) }));
      }

      await handleGenerate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = suggestions.filter(
    (s) => s.selected && s.action !== "SKIP" && s.itemId
  ).length;
  const planYear = planYears.find((y) => y.id === planYearId);
  const editablePlanYears = planYears.filter(isBridgeTargetYear);
  const selectValue =
    planYearId && editablePlanYears.some((y) => y.id === planYearId) ?
      planYearId
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("planYear")}</label>
          <Select
            value={selectValue}
            onValueChange={setPlanYearId}
            disabled={editablePlanYears.length === 0}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("planYearPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {planYears.map((y) => {
                const editable = isBridgeTargetYear(y);
                const suffix =
                  y.isLocked ? ` (${t("planYearLocked")})`
                  : y.status === "ACTIVE" ? ` (${t("planYearActive")})`
                  : "";
                return (
                  <SelectItem key={y.id} value={y.id} disabled={!editable}>
                    {y.year}
                    {suffix}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {planYears.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noPlanYears")}</p>
          )}
          {planYears.length > 0 && editablePlanYears.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noEditablePlanYears")}</p>
          )}
        </div>
        {canApply && (
          <Button onClick={handleGenerate} disabled={loading || !selectValue}>
            {loading ? "..." : t("generate")}
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{t("note")}</p>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Article</TableHead>
                <TableHead>Item Category</TableHead>
                <TableHead className="text-right">{t("forecast")}</TableHead>
                <TableHead className="text-right">{t("categoryTotal")}</TableHead>
                <TableHead className="text-right">{t("planNow")}</TableHead>
                <TableHead className="text-right">{t("delta")}</TableHead>
                <TableHead>{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSuggestions.map((s) => {
                const rowIndex = suggestions.findIndex((row) => row.parentSku === s.parentSku);
                const rowEnabled = isSuggestionRowEnabled(s);
                const effectiveCategoryId = s.overrideItemCategoryId ?? s.itemCategoryId;
                const canApplyRow =
                  rowEnabled &&
                  (s.action === "UPDATE" ||
                    (s.action === "CREATE" && !!effectiveCategoryId));
                return (
                  <TableRow
                    key={s.parentSku}
                    className={cn(!rowEnabled && "opacity-50 pointer-events-none")}
                    aria-disabled={!rowEnabled}
                  >
                    <TableCell>
                      <Checkbox
                        checked={s.selected}
                        disabled={!rowEnabled || s.action === "SKIP"}
                        onCheckedChange={(checked) => {
                          if (rowIndex < 0 || !rowEnabled) return;
                          setSuggestions((prev) =>
                            prev.map((row, i) =>
                              i === rowIndex ? { ...row, selected: !!checked } : row
                            )
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.productName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.parentSku}</div>
                      {!rowEnabled && (
                        <p className="text-xs text-destructive mt-1">{t("noErpItemMapped")}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.action === "CREATE" && !s.canCreate && rowEnabled ?
                        <Select
                          value={s.overrideItemCategoryId ?? ""}
                          onValueChange={(v) => {
                            if (rowIndex < 0) return;
                            setSuggestions((prev) =>
                              prev.map((row, i) =>
                                i === rowIndex ? { ...row, overrideItemCategoryId: v } : row
                              )
                            );
                          }}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={t("selectCategory")} />
                          </SelectTrigger>
                          <SelectContent>
                            {itemCategories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.code ? `${c.code} — ` : ""}
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      : <span className="text-sm">
                          {s.itemCategoryCode ?? "—"} {s.itemCategoryName ?? ""}
                        </span>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="h-8 w-24 ml-auto"
                        value={s.adjustedQty}
                        disabled={!rowEnabled || s.action === "SKIP"}
                        onChange={(e) => {
                          if (rowIndex < 0 || !rowEnabled) return;
                          const v = Number(e.target.value);
                          setSuggestions((prev) =>
                            prev.map((row, i) =>
                              i === rowIndex ? { ...row, adjustedQty: v } : row
                            )
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {s.categoryForecastTotal != null ?
                        s.categoryForecastTotal.toLocaleString()
                      : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.existingPlanTarget != null ?
                        s.existingPlanTarget.toLocaleString()
                      : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {(s.adjustedQty - (s.existingPlanTarget ?? 0)).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {actionBadge(s.action)}
                      {s.action === "CREATE" && !canApplyRow && (
                        <p className="text-xs text-destructive mt-1">{t("selectCategory")}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {suggestions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
          <Button
            onClick={handleApply}
            disabled={applying || selectedCount === 0 || !planYear || !isBridgeTargetYear(planYear)}
          >
            {applying ? "..." : t("apply")} ({selectedCount})
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
