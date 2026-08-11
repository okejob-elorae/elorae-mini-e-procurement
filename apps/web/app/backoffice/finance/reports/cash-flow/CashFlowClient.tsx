"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Wallet } from "lucide-react";
import type { getCashFlowReport } from "@/app/actions/finance-reports";
import type { CashFlowComparisonLine } from "@/lib/finance/reports/cash-flow-compare";
import type { CashFlowLine } from "@/lib/finance/reports/cash-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportExportButtons } from "../ReportExportButtons";
import { exportCashFlowExcel } from "@/app/actions/finance-reports";

type Report = Awaited<ReturnType<typeof getCashFlowReport>>;

type Props = {
  report: Report;
  filters: { from: string; to: string };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function CashFlowClient({ report, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const [isPending, startTransition] = useTransition();

  const cmp = report.comparison;
  const columns = cmp ? 4 : 2;

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    startTransition(() =>
      router.push(`/backoffice/finance/reports/cash-flow?${params.toString()}`),
    );
  }

  function reset() {
    startTransition(() => router.push("/backoffice/finance/reports/cash-flow"));
  }

  function amountCells(values: number[]) {
    return values.map((value, index) => (
      <TableCell key={index} className="text-right tabular-nums">
        {formatRupiah(value)}
      </TableCell>
    ));
  }

  function labelCell(code: string, name: string) {
    return (
      <TableCell className="pl-6">
        <span className="font-mono text-xs text-muted-foreground">{code}</span> {name}
      </TableCell>
    );
  }

  function emptyRow() {
    return (
      <TableRow>
        <TableCell colSpan={columns} className="pl-6 text-muted-foreground">
          {t("cashFlow.sectionEmpty")}
        </TableCell>
      </TableRow>
    );
  }

  /**
   * The two branches are written out rather than mapped over a union, because
   * calling `.map` on a `CashFlowLine[] | CashFlowComparisonLine[]` union is
   * rejected by TypeScript — the two signatures are not compatible.
   */
  function lineRows(lines: CashFlowLine[], paired: CashFlowComparisonLine[] | undefined) {
    if (cmp && paired) {
      if (paired.length === 0) return emptyRow();
      return paired.map((row) => (
        <TableRow key={row.accountId}>
          {labelCell(row.code, row.name)}
          {amountCells([row.current, row.previous, row.delta])}
        </TableRow>
      ));
    }
    if (lines.length === 0) return emptyRow();
    return lines.map((row) => (
      <TableRow key={row.accountId}>
        {labelCell(row.code, row.name)}
        {amountCells([row.amount])}
      </TableRow>
    ));
  }

  function sectionHeader(label: string) {
    return (
      <TableRow className="bg-muted/50">
        <TableCell colSpan={columns} className="font-semibold">
          {label}
        </TableCell>
      </TableRow>
    );
  }

  function totalRow(
    label: string,
    value: number,
    triple: { current: number; previous: number; delta: number } | undefined,
    bold = false,
  ) {
    return (
      <TableRow className={bold ? "border-t-2 font-bold" : "font-semibold"}>
        <TableCell>{label}</TableCell>
        {cmp && triple
          ? amountCells([triple.current, triple.previous, triple.delta])
          : amountCells([value])}
      </TableRow>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("cashFlow.pageTitle")}</h1>
          <p className="text-muted-foreground">{t("cashFlow.subtitle")}</p>
        </div>
        <ReportExportButtons
          onExcel={() => exportCashFlowExcel({ from: filters.from, to: filters.to })}
          printHref={`/print/finance/cash-flow?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`}
        />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.dateFrom")}
            </label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => pushParam("from", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.dateTo")}
            </label>
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

      {!report.hasCashAccount ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">{t("cashFlow.noCashAccountTitle")}</p>
            <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
              {t("cashFlow.noCashAccountBody")}
            </p>
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/backoffice/finance/account-mapping">
                {t("cashFlow.unclassifiedCta")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : !report.hasMovement ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("cashFlow.empty")}
          </CardContent>
        </Card>
      ) : (
        <>
          {report.unclassified.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">{t("cashFlow.unclassifiedTitle")}</p>
                <p className="text-muted-foreground">
                  {t("cashFlow.unclassifiedBody", { count: report.unclassified.length })}
                </p>
                <Link
                  href="/backoffice/finance/cash-flow-sections"
                  className="mt-1 inline-block underline underline-offset-4"
                >
                  {t("cashFlow.unclassifiedCta")}
                </Link>
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {t("cashFlow.cardTitle")}
              </CardTitle>
              {report.previousPeriodLabel && (
                <p className="text-sm text-muted-foreground">
                  {t("cashFlow.comparisonHint", { period: report.previousPeriodLabel })}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  {cmp && (
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead className="text-right">{t("cashFlow.colCurrent")}</TableHead>
                        <TableHead className="text-right">{t("cashFlow.colPrevious")}</TableHead>
                        <TableHead className="text-right">{t("cashFlow.colDelta")}</TableHead>
                      </TableRow>
                    </TableHeader>
                  )}
                  <TableBody>
                    {sectionHeader(t("cashFlow.sectionOperasional"))}
                    <TableRow>
                      <TableCell className="pl-6">{t("cashFlow.labaBersih")}</TableCell>
                      {cmp
                        ? amountCells([
                            cmp.labaBersih.current,
                            cmp.labaBersih.previous,
                            cmp.labaBersih.delta,
                          ])
                        : amountCells([report.labaBersih])}
                    </TableRow>
                    {lineRows(report.operasional, cmp?.operasional)}
                    {totalRow(
                      t("cashFlow.totalOperasional"),
                      report.totalOperasional,
                      cmp?.totalOperasional,
                    )}

                    {sectionHeader(t("cashFlow.sectionInvestasi"))}
                    {lineRows(report.investasi, cmp?.investasi)}
                    {totalRow(
                      t("cashFlow.totalInvestasi"),
                      report.totalInvestasi,
                      cmp?.totalInvestasi,
                    )}

                    {sectionHeader(t("cashFlow.sectionPendanaan"))}
                    {lineRows(report.pendanaan, cmp?.pendanaan)}
                    {totalRow(
                      t("cashFlow.totalPendanaan"),
                      report.totalPendanaan,
                      cmp?.totalPendanaan,
                    )}

                    {report.unclassified.length > 0 && (
                      <>
                        {sectionHeader(t("cashFlow.sectionUnclassified"))}
                        {lineRows(report.unclassified, cmp?.unclassified)}
                        {totalRow(
                          t("cashFlow.totalUnclassified"),
                          report.totalUnclassified,
                          cmp?.totalUnclassified,
                        )}
                      </>
                    )}

                    {totalRow(t("cashFlow.netChange"), report.netChange, cmp?.netChange, true)}
                    <TableRow>
                      <TableCell className="pl-6">{t("cashFlow.kasAwal")}</TableCell>
                      {cmp
                        ? amountCells([cmp.kasAwal.current, cmp.kasAwal.previous, cmp.kasAwal.delta])
                        : amountCells([report.kasAwal])}
                    </TableRow>
                    {totalRow(t("cashFlow.kasAkhir"), report.kasAkhir, cmp?.kasAkhir, true)}
                  </TableBody>
                </Table>
              </div>

              <div
                className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${report.isReconciled ? "border-emerald-500/40 text-muted-foreground" : "border-destructive/50 text-destructive"}`}
              >
                {report.isReconciled ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <p>
                  {report.isReconciled
                    ? t("cashFlow.reconciledNote")
                    : t("cashFlow.unreconciledNote")}
                </p>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t("cashFlow.coverageTitle")}</p>
                  <p className="text-muted-foreground">{t("cashFlow.coverageBody")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
