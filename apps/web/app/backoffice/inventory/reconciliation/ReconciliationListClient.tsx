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
import { getJubelioStockPushEnabled } from "@/app/actions/jubelio-outbox";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { useSession } from "next-auth/react";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { Pagination } from "@/components/ui/pagination";
import { kelompokkanRun } from "./kelompok-run";

/** Baris riwayat per halaman (sesudah kegagalan beruntun disatukan). */
const UKURAN_HALAMAN_RUN = 10;

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

export function ReconciliationListClient({ initialPushEnabled }: { initialPushEnabled: boolean }) {
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
  const [pushEnabled, setPushEnabled] = useState(initialPushEnabled);
  const [savingConfig, setSavingConfig] = useState(false);
  const [halaman, setHalaman] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runRows, config, jubelioPushEnabled] = await Promise.all([
        getReconciliationRuns(),
        getReconciliationConfig(),
        getJubelioStockPushEnabled(),
      ]);
      setRuns(runRows);
      setThreshold(String(config.threshold));
      setDirection(config.direction);
      setCronEnabled(config.cronEnabled);
      setPushEnabled(jubelioPushEnabled);
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
        if (r.failed > 0) toast.warning(t("runCompleteWithFailures", { flagged: r.flagged, failed: r.failed }));
        else toast.success(t("runComplete", { flagged: r.flagged }));
      }
      await load();
    } catch {
      // Pesan lemparan disamarkan di build produksi: selalu teks terjemahan.
      toast.error(t("runFailed"));
    } finally {
      setRunning(false);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const r = await updateReconciliationConfig({
        threshold: Number(threshold),
        direction,
        cronEnabled,
      });
      if (r.success) toast.success(t("configSaved"));
      else toast.error(t(`err.${r.reason}`));
    } catch {
      toast.error(t("configSaveFailed"));
    } finally {
      setSavingConfig(false);
    }
  };

  const staleReassert = direction === "REASSERT_ELORAE" && !pushEnabled;

  // Kegagalan beruntun bersebab sama → satu baris; lalu dipotong per halaman.
  const grupRun = kelompokkanRun(runs, (run) => reconciliationFailureReason(run.errorMessage, t).reason);
  const totalHalaman = Math.max(1, Math.ceil(grupRun.length / UKURAN_HALAMAN_RUN));
  const halamanAman = Math.min(halaman, totalHalaman);
  const halamanGrup = grupRun.slice((halamanAman - 1) * UKURAN_HALAMAN_RUN, halamanAman * UKURAN_HALAMAN_RUN);

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
                    <SelectItem key={d} value={d} disabled={d === "REASSERT_ELORAE" && !pushEnabled}>
                      {t(`directions.${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {staleReassert ? (
                <p className="text-xs text-destructive">{t("staleReassertHint")}</p>
              ) : !pushEnabled ? (
                <p className="text-xs text-muted-foreground">{t("pushDisabledHint")}</p>
              ) : null}
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={cronEnabled} onCheckedChange={setCronEnabled} id="cron-enabled" />
              <Label htmlFor="cron-enabled">{t("cronEnabled")}</Label>
            </div>
            <Button
              className="sm:col-span-3 w-fit"
              variant="secondary"
              onClick={() => void saveConfig()}
              disabled={savingConfig || staleReassert}
            >
              {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
                {halamanGrup.map((grup) => {
                  if (grup.jenis === "gagalBeruntun") {
                    const terbaru = grup.runs[0];
                    const terlama = grup.runs[grup.runs.length - 1];
                    return (
                      <TableRow key={`grup-${terbaru.id}`}>
                        <TableCell className="align-top">
                          <Link href={`/backoffice/inventory/reconciliation/${terbaru.id}`} className={TAUTAN_DOKUMEN}>
                            {formatDisplayDateTime(terbaru.startedAt, locale)}
                          </Link>
                        </TableCell>
                        <TableCell colSpan={5} className="align-top whitespace-normal">
                          <Badge variant="destructive">{t("runStatuses.FAILED")}</Badge>
                          <p className="mt-1 text-sm">
                            {t("gagalBeruntun", {
                              n: grup.runs.length,
                              sejak: formatDisplayDateTime(terlama.startedAt, locale),
                            })}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{grup.sebab}</p>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  const run = grup.run;
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
                        {run.failedCount > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            {t("failedCount", { count: run.failedCount })}
                          </Badge>
                        )}
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
          {!loading && grupRun.length > UKURAN_HALAMAN_RUN && (
            <Pagination
              page={halamanAman}
              totalPages={totalHalaman}
              onPageChange={setHalaman}
              totalCount={grupRun.length}
              pageSize={UKURAN_HALAMAN_RUN}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
