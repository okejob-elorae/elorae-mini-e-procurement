"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
};

export function PlanDashboardTab({ dashboard }: PlanDashboardTabProps) {
  const td = useTranslations("planning.dashboard");
  const { kpi, rows, monthlyTimeline, parentChart } = dashboard;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: td("totalPlan"), value: formatPlanNumber(kpi.totalPlan), band: kpi.completionBand },
          { label: td("totalFulfilled"), value: formatPlanNumber(kpi.totalActual), band: kpi.completionBand },
          { label: td("totalVariance"), value: formatPlanNumber(kpi.totalVariance), band: kpi.completionBand },
          {
            label: td("completion"),
            value: `${kpi.completionPercent}%`,
            band: kpi.completionBand,
          },
        ].map((card) => (
          <Card key={card.label} className={`border-l-4 ${bandAccent[card.band]}`}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="text-xl font-semibold">{card.value}</div>
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
            <CardTitle className="text-base">Plan vs Aktual (Bulanan)</CardTitle>
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
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="font-medium">
                  {row.code} — {row.name}
                </div>
                {row.parentName && (
                  <div className="text-xs text-muted-foreground">{row.parentName}</div>
                )}
              </div>
              <div className="md:col-span-2 text-sm text-right">
                {formatPlanNumber(row.effectiveTarget)}
              </div>
              <div className="md:col-span-2 text-sm text-right">
                {formatPlanNumber(row.actualQty)}
              </div>
              <div className="md:col-span-2 text-sm text-right">
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
    </div>
  );
}
