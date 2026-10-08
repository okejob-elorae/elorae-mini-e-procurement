"use client";

import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Wallet } from "lucide-react";
import type { getCashFlowReport } from "@/app/actions/finance-reports";
import type { CashFlowComparisonLine } from "@/lib/finance/reports/cash-flow-compare";
import { ID_PENYESUAIAN_PELEPASAN_ASET, type CashFlowLine } from "@/lib/finance/reports/cash-flow";
import { Button } from "@/components/ui/button";
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
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { LabelPeriode } from "../LabelPeriode";
import { CASH_FLOW_COVERAGE_BODY } from "@/lib/finance/reports/disclosures";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import { periodeLaporan, type KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";

type Report = Awaited<ReturnType<typeof getCashFlowReport>>;

type Props = {
  report: Report;
  filters: { from: string; to: string };
  /**
   * Both remedies for a cash-flow configuration problem live behind
   * `journals:view`, which `finance_reports:view` does not imply. Without it
   * the links are withheld rather than offered — every one of them redirects
   * straight to the dashboard, which reads as the app breaking. The prose in
   * each state names the fix, so a reader still learns what is wrong.
   */
  canManageJournals: boolean;
  hariIni: string;
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
};

/** Satu format angka laporan keuangan: negatif dalam kurung (`format-laporan.ts`). */
const formatRupiah = rupiahLaporan;

/**
 * The server builds the period label with machine dates ("2026-07-01 — 2026-07-31")
 * because the Excel export shares it; on screen each date reads in the one display format.
 */
function displayPeriodLabel(label: string, locale: string): string {
  return label.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => formatDisplayDate(parseDateOnly(iso), locale));
}

export function CashFlowClient({ report, filters, canManageJournals, hariIni, kesiapan, akses }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const cmp = report.comparison;
  const periode = periodeLaporan({ dari: filters.from, sampai: filters.to }, hariIni);
  // Daftar sumber yang belum berjurnal hanya ditulis di satu tempat (`disclosures.ts`).
  const cakupan = locale.toLowerCase().startsWith("id") ? CASH_FLOW_COVERAGE_BODY : t("cashFlow.coverageBody");
  const columns = cmp ? 4 : 2;

  /**
   * Exports are withheld only when there is no cash account, because both the
   * Excel and the print view refuse in that state anyway — offering a button
   * that produces a refusal note is worse than not offering it. An empty period
   * keeps them: exporting a quiet month is legitimate.
   */
  const canExport = report.hasCashAccount;

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
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

  function labelCell(code: string, name: string, accountId?: string) {
    // Baris penyesuaian pelepasan aset tetap bukan akun: namanya diterjemahkan di layar.
    const tampil = accountId === ID_PENYESUAIAN_PELEPASAN_ASET ? t("cashFlow.penyesuaianPelepasanAset") : name;
    return (
      <TableCell className="pl-6">
        <span className="font-mono text-xs text-muted-foreground">{code}</span> {tampil}
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
          {labelCell(row.code, row.name, row.accountId)}
          {amountCells([row.current, row.previous, row.delta])}
        </TableRow>
      ));
    }
    if (lines.length === 0) return emptyRow();
    return lines.map((row) => (
      <TableRow key={row.accountId}>
        {labelCell(row.code, row.name, row.accountId)}
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
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("cashFlow.pageTitle")}</h1>
            <TombolBantuan judul={t("cashFlow.pageTitle")} />
          </div>
          <LabelPeriode jenis="rentang" dari={periode.dari} sampai={periode.sampai} />
        </div>
        {canExport && (
          <ReportExportButtons
            onExcel={() => exportCashFlowExcel({ from: filters.from, to: filters.to })}
            printHref={`/print/finance/cash-flow?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`}
          />
        )}
      </div>

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
            <RentangTanggalInput
              id="periode"
              dari={filters.from}
              sampai={filters.to}
              onChange={({ dari, sampai }) => pushParams({ from: dari || undefined, to: sampai || undefined })}
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
            {canManageJournals && (
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/backoffice/finance/account-mapping">
                  {t("cashFlow.noCashAccountCta")}
                </Link>
              </Button>
            )}
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
                {canManageJournals && (
                  <Link
                    href="/backoffice/finance/cash-flow-sections"
                    className="mt-1 inline-block underline underline-offset-4"
                  >
                    {t("cashFlow.unclassifiedCta")}
                  </Link>
                )}
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
                  {t("cashFlow.comparisonHint", {
                    period: displayPeriodLabel(report.previousPeriodLabel, locale),
                  })}
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
                  <p className="text-muted-foreground">{cakupan}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
