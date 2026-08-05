"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AlertTriangle, CheckCircle2, Info, Landmark } from "lucide-react";
import type { BalanceSheet } from "@/lib/finance/reports/balance-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ReportSection } from "../ReportSection";
import { ReportExportButtons } from "../ReportExportButtons";
import { exportBalanceSheetExcel } from "@/app/actions/finance-reports";

type Props = {
  report: BalanceSheet;
  openingWarningDate: string | null;
  filters: { asOf: string };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function BalanceSheetClient({ report, openingWarningDate, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    startTransition(() =>
      router.push(`/backoffice/finance/reports/balance-sheet?${params.toString()}`),
    );
  }

  function reset() {
    startTransition(() => router.push("/backoffice/finance/reports/balance-sheet"));
  }

  /**
   * Pinned to WIB so the SSR pass (prod runs UTC) and the browser agree, and so
   * this matches `formatOpeningDate` in `disclosures.ts`, which the print view
   * and the Excel export use for the same warning.
   */
  const formattedEarliest = openingWarningDate
    ? new Intl.DateTimeFormat(locale, {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(openingWarningDate))
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("balanceSheet.pageTitle")}</h1>
          <p className="text-muted-foreground">{t("balanceSheet.subtitle")}</p>
        </div>
        <ReportExportButtons
          onExcel={() => exportBalanceSheetExcel({ asOf: filters.asOf })}
          printHref={`/print/finance/balance-sheet?asOf=${encodeURIComponent(filters.asOf)}`}
        />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.asOf")}</label>
            <Input
              type="date"
              value={filters.asOf}
              onChange={(e) => pushParam("asOf", e.target.value || undefined)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={reset} disabled={isPending}>
              {t("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      {openingWarningDate && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">{t("balanceSheet.openingTitle")}</p>
            <p className="text-muted-foreground">
              {t("balanceSheet.openingBody", { date: formattedEarliest })}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            {t("balanceSheet.cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                <ReportSection
                  title={t("balanceSheet.sectionAset")}
                  nodes={report.aset}
                  total={report.totalAset}
                  totalLabel={t("balanceSheet.totalAset")}
                  emptyLabel={t("balanceSheet.sectionEmpty")}
                />
                <ReportSection
                  title={t("balanceSheet.sectionLiabilitas")}
                  nodes={report.liabilitas}
                  total={report.totalLiabilitas}
                  totalLabel={t("balanceSheet.totalLiabilitas")}
                  emptyLabel={t("balanceSheet.sectionEmpty")}
                />
                <ReportSection
                  title={t("balanceSheet.sectionEkuitas")}
                  nodes={report.ekuitas}
                  total={report.totalEkuitas}
                  totalLabel={t("balanceSheet.totalEkuitas")}
                  emptyLabel={t("balanceSheet.sectionEmpty")}
                />
                <TableRow>
                  <TableCell className="pl-6">{t("balanceSheet.unclosedEarnings")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(report.unclosedEarnings)}
                  </TableCell>
                </TableRow>
                <TableRow className="border-t-2 font-bold">
                  <TableCell>{t("balanceSheet.totalLiabilitasEkuitas")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(report.totalLiabilitasEkuitas)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div
            className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${report.isBalanced ? "border-emerald-500/40 text-muted-foreground" : "border-destructive/50 text-destructive"}`}
          >
            {report.isBalanced ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p>{report.isBalanced ? t("balanceSheet.balancedNote") : t("balanceSheet.unbalancedNote")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
