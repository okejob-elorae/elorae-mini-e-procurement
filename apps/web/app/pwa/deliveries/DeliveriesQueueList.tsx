"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type DeliveryQueueItem = {
  id: string;
  docNo: string;
  storeName: string;
  orderNo: string;
  plannedTotalQty: number;
};

export function DeliveriesQueueList({ rows }: { rows: DeliveryQueueItem[] }) {
  const t = useTranslations("pwa.deliveries");
  const tNav = useTranslations("pwa.nav");

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t("count", { count: rows.length })}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/pwa/deliveries/${r.id}`}>
                <Card className="transition-colors active:bg-accent">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="rounded-full bg-primary p-2 shrink-0">
                      <Truck className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-tight">{r.storeName}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.docNo} · {r.orderNo}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">{t("colQty")}</p>
                      <p className="font-medium tabular-nums">{r.plannedTotalQty}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
