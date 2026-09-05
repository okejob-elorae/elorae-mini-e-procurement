"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listPendingCompletions, deletePendingCompletion, retryPendingCompletion } from "@/lib/pwa/offline/completion-queue";
import { setupOrderSync } from "@/lib/pwa/offline/sync";
import { flushPendingCompletions } from "@/lib/pwa/offline/completion-sync";
import { type PendingCompletion } from "@/lib/pwa/offline/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PendingCompletionsClient() {
  const t = useTranslations("pwa.deliveries.pending");
  const tErr = useTranslations("deliveryShipments");
  const [items, setItems] = useState<PendingCompletion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listPendingCompletions().then(setItems);
  }, []);

  useEffect(() => {
    reload();
    const cleanup = setupOrderSync(reload);
    return cleanup;
  }, [reload]);

  async function handleRetry(shipmentId: string) {
    setBusyId(shipmentId);
    try {
      await retryPendingCompletion(shipmentId);
      const result = await flushPendingCompletions();
      if (result.synced > 0) toast.success(t("syncedToast", { count: result.synced }));
      else if (result.failed > 0) toast.error(t("errGeneric"));
    } finally {
      setBusyId(null);
      reload();
    }
  }

  async function handleDelete(shipmentId: string) {
    setBusyId(shipmentId);
    try {
      await deletePendingCompletion(shipmentId);
    } finally {
      setBusyId(null);
      reload();
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/deliveries">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>

      {items === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      )}

      {items !== null && items.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      )}

      {items !== null && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const busy = busyId === item.shipmentId;
            return (
              <li key={item.shipmentId}>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium leading-tight min-w-0">{item.shipmentId}</p>
                      <Badge
                        variant={item.syncState === "failed" ? "destructive" : item.syncState === "syncing" ? "default" : "secondary"}
                        className="shrink-0"
                      >
                        {item.syncState === "pending" && t("statePending")}
                        {item.syncState === "syncing" && t("stateSyncing")}
                        {item.syncState === "failed" && t("stateFailed")}
                      </Badge>
                    </div>

                    {item.syncState === "failed" && item.error && (
                      <p className="text-xs text-destructive">{tErr(`err.${item.error}` as any)}</p>
                    )}

                    <div className="flex items-center gap-2">
                      {item.syncState === "failed" && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleRetry(item.shipmentId)}
                          className="flex-1"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                          {t("retry")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleDelete(item.shipmentId)}
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
