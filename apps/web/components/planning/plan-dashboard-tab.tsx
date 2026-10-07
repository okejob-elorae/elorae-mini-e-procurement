"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { PlanDashboardData } from "./types";
import { formatPlanNumber } from "./types";

const PlanVsActualChart = dynamic(
  () => import("./plan-dashboard-charts").then((m) => m.PlanVsActualChart),
  { ssr: false }
);
const MonthlyTimelineChart = dynamic(
  () => import("./plan-dashboard-charts").then((m) => m.MonthlyTimelineChart),
  { ssr: false }
);

type PlanDashboardTabProps = {
  dashboard: PlanDashboardData;
};

const bandAccent: Record<string, string> = {
  red: "border-red-500",
  yellow: "border-yellow-500",
  green: "border-green-500",
  netral: "border-sky-500",
};

/** Persen bulat `bagian` dari `total`; 0 bila total 0. */
const persen = (bagian: number, total: number) => (total > 0 ? Math.round((bagian / total) * 100) : 0);

export function PlanDashboardTab({ dashboard }: PlanDashboardTabProps) {
  const td = useTranslations("planning.dashboard");
  const tm = useTranslations("planning.months");
  const { kpi, rows, monthlyTimeline, parentChart, variantRows } = dashboard;
  // Angka PO hanya untuk pemegang purchase_orders:view (server mengirim null).
  const lihatPo = kpi.sudahAdaPo !== null;

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", lihatPo ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-4")}>
        {[
          { label: td("totalPlan"), value: formatPlanNumber(kpi.totalPlan), band: kpi.completionBand },
          { label: td("totalFulfilled"), value: formatPlanNumber(kpi.totalActual), band: kpi.completionBand },
          { label: td("totalVariance"), value: formatPlanNumber(kpi.totalVariance), band: kpi.completionBand },
          {
            label: td("completion"),
            value: `${kpi.completionPercent}%`,
            band: kpi.completionBand,
          },
          ...(kpi.sudahAdaPo !== null
            ? [
                {
                  label: td("sudahAdaPo"),
                  value: formatPlanNumber(kpi.sudahAdaPo),
                  band: "netral",
                  detail:
                    kpi.totalPlan > 0
                      ? td("persenDariPlan", { persen: persen(kpi.sudahAdaPo, kpi.totalPlan) })
                      : null,
                },
              ]
            : []),
        ].map((card) => (
          <Card key={card.label} className={`border-l-4 ${bandAccent[card.band]}`}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="text-xl font-semibold">{card.value}</div>
              {"detail" in card && card.detail ? (
                <div className="text-xs text-muted-foreground">{card.detail}</div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{td("progress")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlanVsActualChart data={parentChart} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{td("monthlyChart")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyTimelineChart data={monthlyTimeline} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{td("progress")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length > 0 && (
            <div className="hidden gap-2 px-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-12">
              <div className={lihatPo ? "md:col-span-3" : "md:col-span-4"}>{td("kolomJenis")}</div>
              <div className="md:col-span-2 text-right">{td("kolomTarget")}</div>
              <div className="md:col-span-2 text-right">{td("kolomTerpenuhi")}</div>
              {lihatPo && <div className="md:col-span-2 text-right">{td("sudahAdaPo")}</div>}
              <div className={cn("text-right", lihatPo ? "md:col-span-1" : "md:col-span-2")}>{td("kolomSelisih")}</div>
              <div className="md:col-span-2 text-right">{td("completion")}</div>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-12">
              <div className={lihatPo ? "md:col-span-3" : "md:col-span-4"}>
                <div className="font-medium">
                  {row.code} — {row.name}
                </div>
                {row.parentName && (
                  <div className="text-xs text-muted-foreground">{row.parentName}</div>
                )}
              </div>
              <div className="md:col-span-2 text-sm text-right">
                <span className="text-muted-foreground md:hidden">{td("kolomTarget")} </span>
                {formatPlanNumber(row.effectiveTarget)}
              </div>
              <div className="md:col-span-2 text-sm text-right">
                <span className="text-muted-foreground md:hidden">{td("kolomTerpenuhi")} </span>
                {formatPlanNumber(row.actualQty)}
              </div>
              {lihatPo && (
                <div className="md:col-span-2 text-sm text-right">
                  <span className="text-muted-foreground md:hidden">{td("sudahAdaPo")} </span>
                  {formatPlanNumber(row.sudahAdaPo ?? 0)}
                </div>
              )}
              <div className={cn("text-sm text-right", lihatPo ? "md:col-span-1" : "md:col-span-2")}>
                <span className="text-muted-foreground md:hidden">{td("kolomSelisih")} </span>
                {formatPlanNumber(row.variance)}
              </div>
              <div className="md:col-span-2">
                <Progress
                  value={Math.min(100, Math.max(0, row.completionPercent))}
                  className={
                    row.completionBand === "red"
                      ? "[&>div]:bg-red-500"
                      : row.completionBand === "yellow"
                        ? "[&>div]:bg-yellow-500"
                        : "[&>div]:bg-green-500"
                  }
                />
                <div className="text-xs text-right">{row.completionPercent}%</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {variantRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{td("variantProgress")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {variantRows.map((row) => (
              <div
                key={`${row.categoryId}-${row.month}-${row.variantSku}`}
                className="grid gap-2 rounded-md border p-2 md:grid-cols-12"
              >
                <div className="md:col-span-4">
                  <div className="font-medium">
                    {row.categoryCode} · {tm(String(row.month))} · {row.variantSku}
                  </div>
                  {row.colorLabel && (
                    <div className="text-xs text-muted-foreground">{row.colorLabel}</div>
                  )}
                </div>
                <div className="md:col-span-2 text-sm text-right">
                  {formatPlanNumber(row.planQty)}
                </div>
                <div className="md:col-span-2 text-sm text-right">
                  {formatPlanNumber(row.actualQty)}
                </div>
                <div className="md:col-span-4">
                  <Progress
                    value={Math.min(100, Math.max(0, row.completionPercent))}
                    className={
                      row.completionBand === "red"
                        ? "[&>div]:bg-red-500"
                        : row.completionBand === "yellow"
                          ? "[&>div]:bg-yellow-500"
                          : "[&>div]:bg-green-500"
                    }
                  />
                  <div className="text-xs text-right">{row.completionPercent}%</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
