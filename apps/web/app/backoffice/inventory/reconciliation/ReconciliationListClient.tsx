"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDateTime } from "@/lib/date-only";
import { reconciliationFailureReason } from "./failure-reason";
import { toast } from "sonner";
import { Loader2, Play, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getReconciliationConfig,
  getReconciliationRuns,
  runReconciliation,
  updateReconciliationConfig,
  type SerializedReconciliationRun,
} from "@/app/actions/stock-reconciliation";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { useSession } from "next-auth/react";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";

function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  switch (action) {
    case "COMPLETED":
      return "default";
    case "FAILED":
      return "destructive";
    default:
      return "secondary";
  }
}

export function ReconciliationListClient() {
  const t = useTranslations("stockReconciliation");
  const locale = useLocale();
  const { data: session } = useSession();
  const canManage = hasPermission(
    session?.user?.permissions ?? [],
    PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE,
  );
  const [runs, setRuns] = useState<SerializedReconciliationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [threshold, setThreshold] = useState("0");
  const [direction, setDirection] = useState("FLAG_ONLY");
  const [cronEnabled, setCronEnabled] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runRows, config] = await Promise.all([
        getReconciliationRuns(),
        getReconciliationConfig(),
      ]);
      setRuns(runRows);
      setThreshold(String(config.threshold));
      setDirection(config.direction);
      setCronEnabled(config.cronEnabled);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const r = await runReconciliation("MANUAL");
      if (r.skipped) {
        toast.message(t("skipped", { reason: r.reason ?? "unknown" }));
      } else {
        toast.success(t("runComplete", { flagged: r.flagged }));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("runFailed"));
    } finally {
      setRunning(false);
    }
  };

  const saveConfig = async () => {
    try {
      await updateReconciliationConfig({
        threshold: Number(threshold),
        direction,
        cronEnabled,
      });
      toast.success(t("configSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("configSaveFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuan judul={t("title")} />
        </div>
        {canManage && (
          <Button onClick={handleRun} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {t("runNow")}
          </Button>
        )}
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              {t("config")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("threshold")}</Label>
              <Input
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("direction")}</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["FLAG_ONLY", "MATCH_JUBELIO", "REASSERT_ELORAE"] as const).map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`directions.${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={cronEnabled} onCheckedChange={setCronEnabled} id="cron-enabled" />
              <Label htmlFor="cron-enabled">{t("cronEnabled")}</Label>
            </div>
            <Button className="sm:col-span-3 w-fit" variant="secondary" onClick={saveConfig}>
              {t("saveConfig")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("runs")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">{t("emptyRuns")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("startedAt")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("scanned")}</TableHead>
                  <TableHead>{t("inSync")}</TableHead>
                  <TableHead>{t("flagged")}</TableHead>
                  <TableHead>{t("autoCorrected")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const failed = run.status === "FAILED";
                  const failure = failed ? reconciliationFailureReason(run.errorMessage, t) : null;
                  // A run that failed before checking anything has no counts —
                  // zeros would read as "checked, all fine".
                  const noCounts = failed && run.totalScanned === 0;
                  const count = (n: number) => (noCounts ? "—" : n);
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="align-top">
                        <Link
                          href={`/backoffice/inventory/reconciliation/${run.id}`}
                          className={TAUTAN_DOKUMEN}
                        >
                          {formatDisplayDateTime(run.startedAt, locale)}
                        </Link>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal min-w-[180px] max-w-[360px]">
                        <Badge variant={actionBadgeVariant(run.status)}>
                          {t(`runStatuses.${run.status as "RUNNING" | "COMPLETED" | "FAILED"}`)}
                        </Badge>
                        {failure && (
                          <p
                            className="mt-1 text-xs text-muted-foreground"
                            title={failure.technical ?? undefined}
                          >
                            {failure.reason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top tabular-nums">{count(run.totalScanned)}</TableCell>
                      <TableCell className="align-top tabular-nums">{count(run.inSync)}</TableCell>
                      <TableCell className="align-top tabular-nums">{count(run.flagged)}</TableCell>
                      <TableCell className="align-top tabular-nums">{count(run.autoCorrected)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
