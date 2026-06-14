"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/sales-orders/format";
import { syncJubelioCouriers, type JubelioCourierRow } from "@/app/actions/jubelio-couriers";

type Props = {
  initialCouriers: JubelioCourierRow[];
};

export function CouriersPageClient({ initialCouriers }: Props) {
  const t = useTranslations("jubelioCouriers");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [couriers] = useState<JubelioCourierRow[]>(initialCouriers);
  const lastSyncedAt = couriers.length > 0
    ? couriers.reduce((acc, c) => (c.syncedAt > acc ? c.syncedAt : acc), couriers[0].syncedAt)
    : null;

  function onSyncClick(): void {
    startTransition(async () => {
      try {
        const r = await syncJubelioCouriers();
        toast.success(t("toast.syncSuccess", { count: r.count }));
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : t("toast.syncError");
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
        <Button onClick={onSyncClick} disabled={isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? "animate-spin" : ""}`} />
          {t("syncButton")}
        </Button>
      </div>

      {lastSyncedAt && (
        <p className="text-sm text-muted-foreground">
          {t("lastSyncedAt", { when: formatDateTime(lastSyncedAt, locale) })}
        </p>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">{t("table.id")}</TableHead>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.syncedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {couriers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              couriers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm">{c.id}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(c.syncedAt, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
