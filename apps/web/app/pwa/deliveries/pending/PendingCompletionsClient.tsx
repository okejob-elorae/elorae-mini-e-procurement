"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listPendingCompletions, deletePendingCompletion, retryPendingCompletion } from "@/lib/pwa/offline/completion-queue";
import { flushPendingCompletions, setupOrderSync } from "@/lib/pwa/offline/sync";
import { type PendingCompletion } from "@/lib/pwa/offline/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PendingCompletionsClient() {
  const t = useTranslations("pwa.deliveries.pending");
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
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/deliveries">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      {items === null && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {items?.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {items?.map((item) => (
        <Card key={item.shipmentId}>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.shipmentId}</p>
              <Badge variant={item.syncState === "failed" ? "destructive" : "secondary"}>
                {item.syncState === "pending" && t("statePending")}
                {item.syncState === "syncing" && t("stateSyncing")}
                {item.syncState === "failed" && t("stateFailed")}
              </Badge>
            </div>
            <div className="flex gap-2">
              {item.syncState === "failed" && (
                <Button size="icon" variant="outline" disabled={busyId === item.shipmentId} onClick={() => handleRetry(item.shipmentId)}>
                  {busyId === item.shipmentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                </Button>
              )}
              <Button size="icon" variant="outline" disabled={busyId === item.shipmentId} onClick={() => handleDelete(item.shipmentId)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
