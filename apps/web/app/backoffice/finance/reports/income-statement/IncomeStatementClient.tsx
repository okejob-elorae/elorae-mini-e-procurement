"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info, TrendingUp } from "lucide-react";
import type { IncomeStatement } from "@/lib/finance/reports/income-statement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ReportSection } from "../ReportSection";
import { ReportExportButtons } from "../ReportExportButtons";
import { exportIncomeStatementExcel } from "@/app/actions/finance-reports";

type Props = {
  report: IncomeStatement;
  filters: { from: string; to: string };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function IncomeStatementClient({ report, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const [isPending, startTransition] = useTransition();

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    startTransition(() =>
      router.push(`/backoffice/finance/reports/income-statement?${params.toString()}`),
    );
  }

  function reset() {
    startTransition(() => router.push("/backoffice/finance/reports/income-statement"));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("incomeStatement.pageTitle")}</h1>
          <p className="text-muted-foreground">{t("incomeStatement.subtitle")}</p>
        </div>
        <ReportExportButtons
          onExcel={() => exportIncomeStatementExcel({ from: filters.from, to: filters.to })}
          printHref={`/print/finance/income-statement?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`}
        />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.dateFrom")}</label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => pushParam("from", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.dateTo")}</label>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => pushParam("to", e.target.value || undefined)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={reset} disabled={isPending}>
              {t("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {t("incomeStatement.cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                <ReportSection
                  title={t("incomeStatement.sectionPendapatan")}
                  nodes={report.pendapatan}
                  total={report.totalPendapatan}
                  totalLabel={t("incomeStatement.totalPendapatan")}
                  emptyLabel={t("incomeStatement.sectionEmpty")}
                />
                <ReportSection
                  title={t("incomeStatement.sectionHpp")}
                  nodes={report.hpp}
                  total={report.totalHpp}
                  totalLabel={t("incomeStatement.totalHpp")}
                  emptyLabel={t("incomeStatement.sectionEmpty")}
                />
                <TableRow className="border-t-2 font-bold">
                  <TableCell>{t("incomeStatement.labaKotor")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(report.labaKotor)}
                  </TableCell>
                </TableRow>
                <ReportSection
                  title={t("incomeStatement.sectionBeban")}
                  nodes={report.beban}
                  total={report.totalBeban}
                  totalLabel={t("incomeStatement.totalBeban")}
                  emptyLabel={t("incomeStatement.sectionEmpty")}
                />
                <TableRow className="border-t-2 font-bold">
                  <TableCell>{t("incomeStatement.labaBersih")}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${report.labaBersih < 0 ? "text-destructive" : ""}`}
                  >
                    {formatRupiah(report.labaBersih)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">{t("incomeStatement.coverageTitle")}</p>
              <p className="text-muted-foreground">{t("incomeStatement.coverageBody")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
