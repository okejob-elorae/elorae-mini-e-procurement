"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { PlanCategoryDetail } from "./types";
import { formatPlanNumber } from "./types";

type MonthlyCardsProps = {
  category: PlanCategoryDetail;
  disabled?: boolean;
  onSaveMonth: (month: number, targetQty: number) => Promise<void>;
  onResetMonth: (month: number) => Promise<void>;
  onResetAll: () => Promise<void>;
};

export function MonthlyCards({
  category,
  disabled,
  onSaveMonth,
  onResetMonth,
  onResetAll,
}: MonthlyCardsProps) {
  const tm = useTranslations("planning.monthly");
  const months = useTranslations("planning.months");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{tm("title")}</div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{tm("total", { value: formatPlanNumber(category.monthlyTotal) })}</span>
          {!disabled && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onResetAll()}>
              <RotateCcw className="mr-1 h-3 w-3" />
              {tm("resetToAuto")}
            </Button>
          )}
        </div>
      </div>

      {category.monthlyMismatch && (
        <p className="text-sm text-yellow-600">
          {tm("mismatchWarning", {
            monthlySum: formatPlanNumber(category.monthlyMismatch.monthlySum),
            effectiveTarget: formatPlanNumber(category.monthlyMismatch.effectiveTarget),
          })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {category.monthlyTargetsComputed.map((month) => {
          const monthKey = String(month.month) as "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";
          return (
            <div
              key={month.month}
              className="rounded-md border p-2 space-y-1"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{months(monthKey)}</span>
                {month.isManualOverride ? (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {tm("manualOverride")}
                  </Badge>
                ) : (
                  <span className="text-[10px]">{tm("autoLabel", { share: "—" })}</span>
                )}
              </div>
              {disabled ? (
                <div className="font-semibold">{formatPlanNumber(month.targetQty)}</div>
              ) : (
                <div className="flex gap-1">
                  <Input
                    type="number"
                    className="h-8 text-sm"
                    defaultValue={month.targetQty}
                    onBlur={async (e) => {
                      const val = Number(e.target.value);
                      if (!Number.isFinite(val)) return;
                      await onSaveMonth(month.month, val);
                    }}
                  />
                  {month.isManualOverride && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => onResetMonth(month.month)}
                      title={tm("resetToAuto")}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
