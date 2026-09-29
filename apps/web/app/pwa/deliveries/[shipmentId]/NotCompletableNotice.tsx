"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_LABEL_KEY: Record<
  string,
  "statusPacked" | "statusInTransit" | "statusDelivered" | "statusPartiallyDelivered" | "statusCancelled"
> = {
  PACKED: "statusPacked",
  IN_TRANSIT: "statusInTransit",
  DELIVERED: "statusDelivered",
  PARTIALLY_DELIVERED: "statusPartiallyDelivered",
  CANCELLED: "statusCancelled",
};

type Props = {
  storeName: string;
  docNo: string;
  status: string;
  method: string;
};

export function NotCompletableNotice({ storeName, docNo, status, method }: Props) {
  const t = useTranslations("pwa.deliveries");
  const tStatus = useTranslations("deliveryShipments");
  const statusKey = STATUS_LABEL_KEY[status];
  const reasonKey = method !== "SALESMAN_CARRY"
    ? "notCompletableExpedition"
    : status === "PACKED" ? "notCompletableNotShipped" : "notCompletableStatus";

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/deliveries">
            <ArrowLeft className="h-4 w-4" />
            {t("title")}
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary p-2 shrink-0">
              <Ban className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{storeName}</p>
              <p className="truncate text-xs text-muted-foreground">{docNo}</p>
            </div>
          </div>
          <p className="text-sm">{t("notCompletableTitle")}</p>
          <p className="text-sm text-muted-foreground">
            {t(reasonKey)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("notCompletableCurrentStatus", { status: statusKey ? tStatus(statusKey) : status })}
          </p>
        </CardContent>
      </Card>

      <Button asChild className="h-11 w-full">
        <Link href="/pwa/deliveries">{t("notCompletableBack")}</Link>
      </Button>
    </div>
  );
}
