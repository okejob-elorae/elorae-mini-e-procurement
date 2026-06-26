"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ReconciliationReport } from "@/lib/sales/sales-reconciliation";
import {
  getReconciliationPeriods,
  runSalesReconciliation,
} from "@/app/actions/sales-reconciliation";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";

type PeriodOption = {
  channel: "SHOPEE" | "TIKTOK";
  periodMonth: number;
  periodYear: number;
};

function periodKey(p: PeriodOption) {
  return `${p.channel}-${p.periodYear}-${p.periodMonth}`;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "IN_SYNC":
      return "bg-green-600";
    case "EXCEL_HIGHER":
      return "bg-orange-600";
    case "JUBELIO_HIGHER":
      return "bg-blue-600";
    default:
      return "bg-muted";
  }
}

interface ReconciliationPageClientProps {
  permissions: string[];
}

export function ReconciliationPageClient({
  permissions,
}: ReconciliationPageClientProps) {
  const t = useTranslations("forecast.reconciliation");
  const canManage = hasPermission(permissions, PERMISSIONS.FORECAST_MANAGE);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPeriod = useMemo(
    () => periods.find((p) => periodKey(p) === selectedKey) ?? null,
    [periods, selectedKey]
  );

  const loadPeriods = useCallback(async () => {
    const rows = await getReconciliationPeriods();
    const filtered = rows.filter(
      (r): r is PeriodOption =>
        r.channel === "SHOPEE" || r.channel === "TIKTOK"
    );
    setPeriods(filtered);
    if (filtered.length > 0 && !selectedKey) {
      setSelectedKey(periodKey(filtered[0]!));
    }
  }, [selectedKey]);

  const loadReport = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    try {
      const res = await runSalesReconciliation(selectedPeriod);
      if (!res.success || !res.report) {
        toast.error(res.error ?? t("loadFailed"));
        return;
      }
      setReport(res.report);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, t]);

  useEffect(() => {
    loadPeriods().catch((err) =>
      toast.error(err instanceof Error ? err.message : t("loadFailed"))
    );
  }, [loadPeriods, t]);

  useEffect(() => {
    if (selectedPeriod) {
      loadReport();
    }
  }, [selectedPeriod, loadReport]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/backoffice/forecast/import">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Alert>
        <AlertDescription>{t("stockDisclaimer")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("periodSelector")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedKey} onValueChange={setSelectedKey}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t("selectPeriod")} />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={periodKey(p)} value={periodKey(p)}>
                    {p.channel} — {p.periodMonth}/{p.periodYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadReport}
                disabled={loading || !selectedPeriod}
              >
                {loading ? t("loading") : t("refresh")}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {report && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("excelTotal")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {report.excelTotal.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("jubelioTotal")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {report.jubelioTotal.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("delta")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {report.delta > 0 ? "+" : ""}
                  {report.delta.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("itemTableTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("parentSku")}</TableHead>
                    <TableHead>{t("product")}</TableHead>
                    <TableHead className="text-right">{t("excelQty")}</TableHead>
                    <TableHead className="text-right">{t("jubelioQty")}</TableHead>
                    <TableHead className="text-right">{t("delta")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.items.map((row) => (
                    <TableRow key={row.groupKey}>
                      <TableCell className="font-mono text-sm">
                        {row.parentSku}
                      </TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell className="text-right">
                        {row.excelQty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.jubelioQty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.delta > 0 ? "+" : ""}
                        {row.delta.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadgeClass(row.status)}>
                          {t(`statusLabel.${row.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {report.items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {t("empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {report.unmappedSkus.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("unmappedTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("unmappedHint")}
                </p>
                <ul className="list-inside list-disc text-sm font-mono">
                  {report.unmappedSkus.map((sku) => (
                    <li key={sku}>{sku}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
