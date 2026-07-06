"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listPendingOrders, deletePendingOrder, retryPendingOrder } from "@/lib/pwa/offline/queue";
import { flushPendingOrders, setupOrderSync } from "@/lib/pwa/offline/sync";
import { type PendingOrder } from "@/lib/pwa/offline/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function errorLabel(code: string | undefined, t: (key: string) => string): string {
  switch (code) {
    case "MIN_QTY":
      return t("errMinQty");
    case "NO_ACTIVE_VISIT":
      return t("errNoVisit");
    case "UNAUTHORIZED":
      return t("errUnauthorized");
    default:
      return t("errGeneric");
  }
}

export function PendingOrdersClient() {
  const t = useTranslations("pwa.offline");
  const [orders, setOrders] = useState<PendingOrder[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listPendingOrders().then(setOrders);
  }, []);

  useEffect(() => {
    reload();
    const cleanup = setupOrderSync(reload);
    return cleanup;
  }, [reload]);

  async function handleRetry(order: PendingOrder) {
    setBusyId(order.localId);
    try {
      await retryPendingOrder(order.localId);
      const result = await flushPendingOrders();
      if (result.synced > 0) toast.success(t("syncedToast", { count: result.synced }));
      else if (result.failed > 0) toast.error(t("errGeneric"));
    } finally {
      setBusyId(null);
      reload();
    }
  }

  async function handleDelete(localId: string) {
    setBusyId(localId);
    try {
      await deletePendingOrder(localId);
    } finally {
      setBusyId(null);
      reload();
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <h1 className="text-2xl font-bold leading-tight">{t("pendingTitle")}</h1>

      {orders === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      )}

      {orders !== null && orders.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      )}

      {orders !== null && orders.length > 0 && (
        <ul className="space-y-2">
          {orders.map(order => {
            const busy = busyId === order.localId;
            return (
              <li key={order.localId}>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium leading-tight">{order.storeName}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("lines", { count: order.lines.length })}
                        </p>
                      </div>
                      <Badge
                        variant={order.syncState === "failed" ? "destructive" : order.syncState === "syncing" ? "default" : "secondary"}
                        className="shrink-0"
                      >
                        {order.syncState === "failed" && t("stateFailed")}
                        {order.syncState === "syncing" && t("stateSyncing")}
                        {order.syncState === "pending" && t("statePending")}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {t("capturedAt")}: {new Date(order.capturedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                    </p>

                    {order.syncState === "failed" && (
                      <p className="text-xs text-destructive">{errorLabel(order.error, t)}</p>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleRetry(order)}
                        className="flex-1"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                        {t("retry")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleDelete(order.localId)}
                        className="flex-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("delete")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
