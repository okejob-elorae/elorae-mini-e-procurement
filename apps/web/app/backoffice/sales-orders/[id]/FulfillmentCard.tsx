"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SalesOrderFulfillmentStatus } from "@/lib/constants/enums";
import { formatDateTime } from "@/lib/sales-orders/format";
import {
  finishPickAction,
  finishPackAction,
  shipOrderAction,
  getCouriersForShipDialog,
  FULFILLMENT_FORBIDDEN_REASON,
  type CourierOption,
  type FulfillmentActionResult,
} from "@/app/actions/sales-order-fulfillment";

const STATUS_TAILWIND: Record<SalesOrderFulfillmentStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PICKED: "bg-amber-100 text-amber-800 border-amber-200",
  PACKED: "bg-blue-100 text-blue-800 border-blue-200",
  SHIPPED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type Props = {
  orderId: string;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  isLocked: boolean;
  canFulfill: boolean;
  pickedAt: Date | null;
  pickedByName: string | null;
  packedAt: Date | null;
  packedByName: string | null;
  shippedAt: Date | null;
  shippedByName: string | null;
  trackingNumber: string | null;
  courierName: string | null;
};

export function FulfillmentCard(props: Props) {
  const t = useTranslations("salesOrders.fulfillment");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [couriersLoaded, setCouriersLoaded] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<number | null>(null);
  const [shipDialogOpen, setShipDialogOpen] = useState(false);

  function handleResult(r: FulfillmentActionResult): void {
    if (r.ok) {
      toast.success(t("toast.success"));
    } else if (r.reason === FULFILLMENT_FORBIDDEN_REASON) {
      toast.error(t("toast.forbidden"));
    } else {
      toast.warning(t("toast.invalidTransition"));
    }
  }

  function callAction(promise: Promise<FulfillmentActionResult>): void {
    startTransition(async () => {
      try {
        const r = await promise;
        handleResult(r);
      } catch {
        toast.error(t("toast.networkError"));
      }
    });
  }

  async function ensureCouriersLoaded(): Promise<void> {
    if (couriersLoaded) return;
    try {
      const list = await getCouriersForShipDialog();
      setCouriers(list);
      setCouriersLoaded(true);
    } catch {
      toast.error(t("toast.networkError"));
    }
  }

  const selectedCourierName =
    selectedCourier !== null
      ? couriers.find((c) => c.id === selectedCourier)?.name ?? ""
      : "";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("section")}</h2>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_TAILWIND[props.fulfillmentStatus]}`}
        >
          {t(`statusValues.${props.fulfillmentStatus}` as never)}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        <TimelineRow
          label={t("timelinePicked")}
          at={props.pickedAt}
          by={props.pickedByName}
          locale={locale}
          byUserLabel={(name) => t("byUser", { name })}
        />
        <TimelineRow
          label={t("timelinePacked")}
          at={props.packedAt}
          by={props.packedByName}
          locale={locale}
          byUserLabel={(name) => t("byUser", { name })}
        />
        <TimelineRow
          label={t("timelineShipped")}
          at={props.shippedAt}
          by={props.shippedByName}
          locale={locale}
          byUserLabel={(name) => t("byUser", { name })}
        />
      </div>

      {props.trackingNumber && (
        <div className="text-sm pt-2 border-t">
          <span className="text-muted-foreground">{t("tracking")}: </span>
          <span className="font-mono">
            {props.courierName ? `${props.courierName} · ` : ""}
            {props.trackingNumber}
          </span>
        </div>
      )}

      {props.isLocked ? (
        <div className="text-sm text-muted-foreground italic">{t("cancelledLocked")}</div>
      ) : props.canFulfill ? (
        <div className="pt-2 border-t">
          {props.fulfillmentStatus === "PENDING" && (
            <Button
              disabled={isPending}
              onClick={() => callAction(finishPickAction(props.orderId))}
            >
              {t("action.finishPick")}
            </Button>
          )}
          {props.fulfillmentStatus === "PICKED" && (
            <Button
              disabled={isPending}
              onClick={() => callAction(finishPackAction(props.orderId))}
            >
              {t("action.finishPack")}
            </Button>
          )}
          {props.fulfillmentStatus === "PACKED" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">
                  {t("action.courier")}
                </label>
                <Select
                  value={selectedCourier !== null ? String(selectedCourier) : ""}
                  onValueChange={(v) => setSelectedCourier(Number(v))}
                  onOpenChange={(open) => {
                    if (open) void ensureCouriersLoaded();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("action.courierPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {couriers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={isPending || selectedCourier === null}
                onClick={() => setShipDialogOpen(true)}
              >
                {t("action.ship")}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <AlertDialog open={shipDialogOpen} onOpenChange={setShipDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("action.shipConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("action.shipConfirmBody", { courier: selectedCourierName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.shipConfirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCourier !== null) {
                  callAction(shipOrderAction(props.orderId, selectedCourier));
                }
              }}
            >
              {t("action.shipConfirmOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TimelineRow({
  label,
  at,
  by,
  locale,
  byUserLabel,
}: {
  label: string;
  at: Date | null;
  by: string | null;
  locale: string;
  byUserLabel: (name: string) => string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {at ? formatDateTime(at, locale) : "—"}
        {by ? <span className="text-muted-foreground ml-2">{byUserLabel(by)}</span> : null}
      </span>
    </div>
  );
}
