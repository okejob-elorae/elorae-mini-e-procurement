"use client";

import { AlertTriangle, Package, PackageX, TrendingDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StockStatus } from "@/lib/inventory/stock-status";

export type StockHealthKpiSummary = {
  totalAvailable: number;
  totalItems: number;
  totalValue: number;
  menipisCount: number;
  habisCount: number;
  negatifCount: number;
};

type Props = {
  summary: StockHealthKpiSummary;
  activeStatus: StockStatus | null;
  onSelectStatus: (status: StockStatus | null) => void;
};

export function StockHealthKpis({ summary, activeStatus, onSelectStatus }: Props) {
  const t = useTranslations("inventory.wallboard");

  const toggle = (status: StockStatus) => {
    onSelectStatus(activeStatus === status ? null : status);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{t("kpiTotalStock")}</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {summary.totalAvailable.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("kpiTotalStockHint", { count: summary.totalItems })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("kpiTotalValue", { value: summary.totalValue.toLocaleString() })}
          </p>
        </CardContent>
      </Card>

      <button
        type="button"
        onClick={() => toggle("MENIPIS")}
        className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card
          className={cn(
            "h-full transition-colors",
            activeStatus === "MENIPIS" && "border-amber-500 ring-1 ring-amber-500/40",
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiMenipis")}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {summary.menipisCount}
            </div>
            <p className="text-xs text-muted-foreground">{t("kpiMenipisHint")}</p>
          </CardContent>
        </Card>
      </button>

      <button
        type="button"
        onClick={() => toggle("HABIS")}
        className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card
          className={cn(
            "h-full transition-colors",
            activeStatus === "HABIS" && "border-destructive ring-1 ring-destructive/40",
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiHabis")}</CardTitle>
            <PackageX className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {summary.habisCount}
            </div>
            <p className="text-xs text-muted-foreground">{t("kpiHabisHint")}</p>
          </CardContent>
        </Card>
      </button>

      <button
        type="button"
        onClick={() => toggle("NEGATIF")}
        className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card
          className={cn(
            "h-full transition-colors",
            activeStatus === "NEGATIF" && "border-pink-500 ring-1 ring-pink-500/40",
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiNegatif")}</CardTitle>
            <TrendingDown className="h-4 w-4 text-pink-600 dark:text-pink-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-pink-600 dark:text-pink-400">
              {summary.negatifCount}
            </div>
            <p className="text-xs text-muted-foreground">{t("kpiNegatifHint")}</p>
          </CardContent>
        </Card>
      </button>
    </div>
  );
}
