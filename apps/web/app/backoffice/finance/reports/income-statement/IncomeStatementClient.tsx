"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Info, TrendingUp } from "lucide-react";
import type { IncomeStatement } from "@/lib/finance/reports/income-statement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody } from "@/components/ui/table";
import { BarisTotalLaporan, KepalaKolomLaporan, ReportSection } from "../ReportSection";
import { ReportExportButtons } from "../ReportExportButtons";
import { exportIncomeStatementExcel } from "@/app/actions/finance-reports";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { INCOME_STATEMENT_COVERAGE_BODY } from "@/lib/finance/reports/disclosures";
import { LabelPeriode } from "../LabelPeriode";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import { periodeLaporan, type KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";
import { tautanBukuBesar } from "../../journals/_sumber/tautan";

type Props = {
  report: IncomeStatement;
  filters: { from: string; to: string; nol: boolean };
  /** Ada baris jurnal pada periode ini — bila tidak, tampil keadaan kosong, bukan deretan Rp 0. */
  adaMutasi: boolean;
  hariIni: string;
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
};

export function IncomeStatementClient({ report, filters, adaMutasi, hariIni, kesiapan, akses }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const periode = periodeLaporan({ dari: filters.from, sampai: filters.to }, hariIni);
  const tautanAkun = akses.jurnal ? (accountId: string) => tautanBukuBesar(accountId, periode) : undefined;
  // Daftar sumber yang belum berjurnal hanya ditulis di satu tempat (`disclosures.ts`).
  const cakupan = locale.toLowerCase().startsWith("id")
    ? INCOME_STATEMENT_COVERAGE_BODY
    : t("incomeStatement.coverageBody");
  const [isPending, startTransition] = useTransition();

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
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
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("incomeStatement.pageTitle")}</h1>
            <TombolBantuan judul={t("incomeStatement.pageTitle")} />
          </div>
          <LabelPeriode jenis="rentang" dari={periode.dari} sampai={periode.sampai} />
        </div>
        <ReportExportButtons
          onExcel={() => exportIncomeStatementExcel({ from: filters.from, to: filters.to, nol: filters.nol })}
          printHref={`/print/finance/income-statement?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}&nol=${filters.nol ? "1" : "0"}`}
        />
      </div>

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
            <RentangTanggalInput
              id="periode"
              dari={filters.from}
              sampai={filters.to}
              onChange={({ dari, sampai }) => pushParams({ from: dari || undefined, to: sampai || undefined })}
            />
          </div>
          <div className="flex items-end gap-2">
            <Checkbox
              id="tampilNol"
              checked={filters.nol}
              disabled={isPending}
              onCheckedChange={(checked) => pushParams({ nol: checked === true ? "1" : undefined })}
            />
            <Label htmlFor="tampilNol" className="text-sm font-normal cursor-pointer">
              {t("filter.showZeroAccounts")}
            </Label>
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
          {!adaMutasi ? (
            <div className="text-center py-12">
              <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("incomeStatement.empty")}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <KepalaKolomLaporan />
                  <TableBody>
                    <ReportSection
                      title={t("incomeStatement.sectionPendapatan")}
                      nodes={report.pendapatan}
                      total={report.totalPendapatan}
                      totalLabel={t("incomeStatement.totalPendapatan")}
                      emptyLabel={t("incomeStatement.sectionEmpty")}
                      tautanAkun={tautanAkun}
                      tampilkanNol={filters.nol}
                    />
                    <ReportSection
                      title={t("incomeStatement.sectionHpp")}
                      nodes={report.hpp}
                      total={report.totalHpp}
                      totalLabel={t("incomeStatement.totalHpp")}
                      emptyLabel={t("incomeStatement.sectionEmpty")}
                      tautanAkun={tautanAkun}
                      tampilkanNol={filters.nol}
                    />
                    <BarisTotalLaporan label={t("incomeStatement.labaKotor")} nilai={report.labaKotor} />
                    <ReportSection
                      title={t("incomeStatement.sectionBeban")}
                      nodes={report.beban}
                      total={report.totalBeban}
                      totalLabel={t("incomeStatement.totalBeban")}
                      emptyLabel={t("incomeStatement.sectionEmpty")}
                      tautanAkun={tautanAkun}
                      tampilkanNol={filters.nol}
                    />
                    <BarisTotalLaporan label={t("incomeStatement.labaBersih")} nilai={report.labaBersih} negatifMerah />
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">{t("incomeStatement.coverageTitle")}</p>
                  <p className="text-muted-foreground">{cakupan}</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
