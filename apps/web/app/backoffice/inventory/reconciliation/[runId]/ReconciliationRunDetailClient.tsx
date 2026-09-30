"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  getReconciliationRunById,
  resolveReconciliationItem,
  type SerializedReconciliationRunDetail,
} from "@/app/actions/stock-reconciliation";
import { getJubelioStockPushEnabled } from "@/app/actions/jubelio-outbox";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { useSession } from "next-auth/react";
import { ReconciliationBulkMatch } from "./ReconciliationBulkMatch";

type ReconActionKey = "IN_SYNC" | "AUTO_CORRECTED" | "FLAGGED" | "MANUALLY_RESOLVED";

function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  switch (action) {
    case "FLAGGED":
      return "destructive";
    case "AUTO_CORRECTED":
    case "MANUALLY_RESOLVED":
      return "default";
    case "IN_SYNC":
      return "secondary";
    default:
      return "outline";
  }
}

function runStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
      return "default";
    case "FAILED":
      return "destructive";
    default:
      return "secondary";
  }
}

export function ReconciliationRunDetailClient({
  runId,
  initialPushEnabled,
}: {
  runId: string;
  initialPushEnabled: boolean;
}) {
  const t = useTranslations("stockReconciliation");
  const { data: session } = useSession();
  const canManage = hasPermission(
    session?.user?.permissions ?? [],
    PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE,
  );
  const [run, setRun] = useState<SerializedReconciliationRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(initialPushEnabled);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  /* `silent` refreshes in place, keeping the table (and the bulk summary under it) mounted. */
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [runDetail, jubelioPushEnabled] = await Promise.all([
        getReconciliationRunById(runId),
        getJubelioStockPushEnabled(),
      ]);
      setRun(runDetail);
      setPushEnabled(jubelioPushEnabled);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flaggedIds = useMemo(
    () => (run?.results ?? []).filter((row) => row.action === "FLAGGED").map((row) => row.id),
    [run],
  );
  /* Only FLAGGED rows are resolvable, so a selection that outlived a resolve narrows to what is left. */
  const effectiveSelectedIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return flaggedIds.filter((id) => selected.has(id));
  }, [flaggedIds, selectedIds]);
  const selectedSet = useMemo(() => new Set(effectiveSelectedIds), [effectiveSelectedIds]);
  const allFlaggedSelected = flaggedIds.length > 0 && effectiveSelectedIds.length === flaggedIds.length;
  const headerChecked = allFlaggedSelected ? true : effectiveSelectedIds.length > 0 ? "indeterminate" : false;

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  const resolve = async (resultId: string, direction: "MATCH_JUBELIO" | "REASSERT_ELORAE") => {
    setResolvingId(resultId);
    try {
      const r = await resolveReconciliationItem({ resultId, direction });
      if (!r.success) {
        toast.error(t(`err.${r.reason}`));
        return;
      }
      toast.success(t("resolved"));
      await load({ silent: true });
    } catch {
      toast.error(t("resolveFailed"));
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground py-8">{t("loading")}</p>;
  }

  if (!run) {
    return <p className="text-muted-foreground py-8">{t("notFound")}</p>;
  }

  const failedRowCount = run.results.filter((r) => r.errorMessage !== null).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{t("runTitle", { id: runId.slice(0, 8) })}</h1>
            <Badge variant={runStatusBadgeVariant(run.status)}>
              {t(`runStatuses.${run.status as "RUNNING" | "COMPLETED" | "FAILED"}`)}
            </Badge>
          </div>
          <p className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
          {run.status === "COMPLETED" && failedRowCount > 0 ? (
            <p className="text-sm text-destructive">
              {t("rowsFailedSummary", { failed: failedRowCount, total: run.totalScanned })}
            </p>
          ) : null}
          {run.status === "FAILED" && run.errorMessage ? (
            <p className="text-sm text-destructive">{run.errorMessage}</p>
          ) : null}
        </div>
        <Link href="/backoffice/inventory/reconciliation">
          <Button variant="outline">{t("back")}</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("results")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("eloraeQtyHint")}</p>
          {canManage && !pushEnabled && (
            <p className="text-xs text-muted-foreground">{t("pushDisabledHint")}</p>
          )}
        </CardHeader>
        <CardContent>
          {canManage && (
            <ReconciliationBulkMatch
              rows={run.results}
              selectedIds={effectiveSelectedIds}
              onSelectionChange={setSelectedIds}
              running={bulkRunning}
              blocked={resolvingId !== null}
              onRunningChange={setBulkRunning}
              onFinished={() => load({ silent: true })}
            />
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={headerChecked}
                      disabled={bulkRunning || flaggedIds.length === 0}
                      onCheckedChange={(checked) => setSelectedIds(checked === true ? flaggedIds : [])}
                      aria-label={t("bulk.selectAllAria")}
                    />
                  </TableHead>
                )}
                <TableHead>{t("item")}</TableHead>
                <TableHead>{t("eloraeQty")}</TableHead>
                <TableHead>{t("jubelioQty")}</TableHead>
                <TableHead>{t("variance")}</TableHead>
                <TableHead>{t("action")}</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.results.map((row) => {
                /* Variants of one item share its name, so the variant keeps each checkbox label distinct. */
                const rowLabel = row.variantSku ? `${row.itemName} ${row.variantSku}` : row.itemName;
                return (
                  <TableRow key={row.id}>
                    {canManage && (
                      <TableCell>
                        {row.action === "FLAGGED" && (
                          <Checkbox
                            checked={selectedSet.has(row.id)}
                            disabled={bulkRunning}
                            onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                            aria-label={t("bulk.selectRowAria", { item: rowLabel })}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div>{row.itemName}</div>
                      {row.variantSku ? (
                        <div className="text-xs text-muted-foreground">{row.variantSku}</div>
                      ) : null}
                      {row.action === "FLAGGED" && row.errorMessage ? (
                        <div
                          className="max-w-xs truncate text-xs text-destructive"
                          title={row.errorMessage}
                        >
                          {t("rowFailed", { message: row.errorMessage })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{row.eloraeQty}</TableCell>
                    <TableCell>
                      {row.jubelioQty === null ? (
                        <span className="text-muted-foreground">{t("noJubelioFigure")}</span>
                      ) : (
                        row.jubelioQty
                      )}
                    </TableCell>
                    <TableCell>
                      {row.variance === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.variance > 0 ? (
                        `+${row.variance}`
                      ) : (
                        row.variance
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionBadgeVariant(row.action)}>
                        {t(`actions.${row.action as ReconActionKey}`)}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="space-x-2">
                        {row.action === "FLAGGED" && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={bulkRunning || resolvingId === row.id}
                              onClick={() => resolve(row.id, "MATCH_JUBELIO")}
                            >
                              {t("matchJubelio")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={bulkRunning || resolvingId === row.id || !pushEnabled}
                              onClick={() => resolve(row.id, "REASSERT_ELORAE")}
                            >
                              {t("reassertElorae")}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {run.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 5} className="py-8 text-center text-muted-foreground">
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
