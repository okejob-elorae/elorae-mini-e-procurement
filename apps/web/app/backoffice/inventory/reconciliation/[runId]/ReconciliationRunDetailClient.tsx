"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  getReconciliationRunById,
  resolveReconciliationItem,
  type SerializedReconciliationRunDetail,
} from "@/app/actions/stock-reconciliation";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { useSession } from "next-auth/react";

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

export function ReconciliationRunDetailClient({ runId }: { runId: string }) {
  const t = useTranslations("stockReconciliation");
  const { data: session } = useSession();
  const canManage = hasPermission(
    session?.user?.permissions ?? [],
    PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE,
  );
  const [run, setRun] = useState<SerializedReconciliationRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRun(await getReconciliationRunById(runId));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (resultId: string, direction: "MATCH_JUBELIO" | "REASSERT_ELORAE") => {
    setResolvingId(resultId);
    try {
      const r = await resolveReconciliationItem({ resultId, direction });
      if (!r.success) {
        toast.error(r.error ?? t("resolveFailed"));
        return;
      }
      toast.success(t("resolved"));
      await load();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("runTitle", { id: runId.slice(0, 8) })}</h1>
          <p className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
        </div>
        <Link href="/backoffice/inventory/reconciliation">
          <Button variant="outline">{t("back")}</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("results")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("item")}</TableHead>
                <TableHead>{t("eloraeQty")}</TableHead>
                <TableHead>{t("jubelioQty")}</TableHead>
                <TableHead>{t("variance")}</TableHead>
                <TableHead>{t("action")}</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.results.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div>{row.itemName}</div>
                    {row.variantSku ? (
                      <div className="text-xs text-muted-foreground">{row.variantSku}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.eloraeQty}</TableCell>
                  <TableCell>{row.jubelioQty}</TableCell>
                  <TableCell>{row.variance > 0 ? `+${row.variance}` : row.variance}</TableCell>
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
                            disabled={resolvingId === row.id}
                            onClick={() => resolve(row.id, "MATCH_JUBELIO")}
                          >
                            {t("matchJubelio")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolvingId === row.id}
                            onClick={() => resolve(row.id, "REASSERT_ELORAE")}
                          >
                            {t("reassertElorae")}
                          </Button>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {run.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="py-8 text-center text-muted-foreground">
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
