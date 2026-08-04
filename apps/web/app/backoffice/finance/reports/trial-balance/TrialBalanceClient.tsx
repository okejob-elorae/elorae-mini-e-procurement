"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import type { TrialBalance } from "@/lib/finance/reports/trial-balance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { exportTrialBalanceExcel } from "@/app/actions/finance-reports";

type Props = {
  report: TrialBalance;
  filters: { from: string; to: string; zero: boolean };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function TrialBalanceClient({ report, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeReports");
  const [isPending, startTransition] = useTransition();

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    startTransition(() =>
      router.push(`/backoffice/finance/reports/trial-balance?${params.toString()}`),
    );
  }

  function reset() {
    startTransition(() => router.push("/backoffice/finance/reports/trial-balance"));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("trialBalance.pageTitle")}</h1>
          <p className="text-muted-foreground">{t("trialBalance.subtitle")}</p>
        </div>
        <ReportExportButtons
          onExcel={() =>
            exportTrialBalanceExcel({
              from: filters.from,
              to: filters.to,
              includeZero: filters.zero,
            })
          }
          printHref={`/print/finance/trial-balance?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}&zero=${filters.zero ? "1" : "0"}`}
        />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
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
          <div className="flex items-end gap-2">
            <Checkbox
              id="showZero"
              checked={filters.zero}
              disabled={isPending}
              onCheckedChange={(checked) => pushParam("zero", checked === true ? "1" : undefined)}
            />
            <Label htmlFor="showZero" className="text-sm font-normal cursor-pointer">
              {t("filter.showZero")}
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
            <Scale className="h-5 w-5" />
            {t("trialBalance.listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <div className="text-center py-12">
              <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {filters.from || filters.to ? t("trialBalance.emptyFiltered") : t("trialBalance.empty")}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("trialBalance.colCode")}</TableHead>
                      <TableHead>{t("trialBalance.colName")}</TableHead>
                      <TableHead className="text-right">{t("trialBalance.colDebit")}</TableHead>
                      <TableHead className="text-right">{t("trialBalance.colCredit")}</TableHead>
                      <TableHead className="text-right">{t("trialBalance.colBalance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row) => (
                      <TableRow key={row.accountId}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.code}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.debit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.credit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.signed)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell colSpan={2}>{t("trialBalance.totalRow")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(report.totalDebit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(report.totalCredit)}</TableCell>
                      <TableCell />
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
                <p>
                  {report.isBalanced ? t("trialBalance.balancedNote") : t("trialBalance.unbalancedNote")}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
