"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { formatDateTime, formatIDR } from "@/lib/sales-orders/format";
import type {
  FieldSalesDeliveryStatus,
  FieldSalesDeliverySummary,
  FieldSalesOrderStatus,
  FieldSalesOrderType,
} from "@/lib/field-sales/queries";
import { closeRemainderAction } from "@/app/actions/field-sales-deliveries";
import { DeliveryFormDialog, deliveryErrorKey, type DeliverableLine } from "./DeliveryFormDialog";

type Props = {
  orderId: string;
  orderType: FieldSalesOrderType;
  status: FieldSalesOrderStatus;
  deliveryStatus: FieldSalesDeliveryStatus;
  deliveries: FieldSalesDeliverySummary[];
  lines: DeliverableLine[];
  canDeliver: boolean;
};

const DELIVERY_BADGE_VARIANT: Record<FieldSalesDeliveryStatus, "secondary" | "default" | "outline"> = {
  PENDING: "secondary",
  PARTIAL: "outline",
  DELIVERED: "default",
  CLOSED: "outline",
};

/* PARTIAL is the only state still waiting on someone; CLOSED is a settled write-off, so it stays muted. */
const DELIVERY_BADGE_CLASS: Record<FieldSalesDeliveryStatus, string> = {
  PENDING: "",
  PARTIAL: "border-amber-500/40 text-amber-700",
  DELIVERED: "",
  CLOSED: "text-muted-foreground",
};

/**
 * CardHeader places its action slot in a second grid column, which squeezes the title on a
 * phone. Below the sm breakpoint the actions drop to their own row under the title, which
 * also means cancelling the base slot's row-span and its justify-self-end pin.
 */
const ACTION_SLOT_CLASS = [
  "flex flex-wrap gap-2 justify-end",
  "max-sm:col-start-1 max-sm:row-start-2 max-sm:row-span-1",
  "max-sm:justify-self-start max-sm:justify-start",
].join(" ");

function formatDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function totalQty(delivery: FieldSalesDeliverySummary): number {
  return delivery.lines.reduce((sum, line) => sum + line.qty, 0);
}

export function DeliveriesCard({
  orderId,
  orderType,
  status,
  deliveryStatus,
  deliveries,
  lines,
  canDeliver,
}: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");

  /* Konsi transfers never deliver in this slice, and a not-yet-approved order has nothing to show. */
  if (orderType === "KONSI") return null;
  if (status !== "APPROVED" && deliveries.length === 0) return null;

  const hasOutstanding = lines.some((line) => line.outstanding > 0);
  const showActions = canDeliver && status === "APPROVED";
  const statusKey = `delivery.status.${deliveryStatus}`;

  function callClose(): void {
    const reason = closeReason.trim();
    if (!reason) return;
    startTransition(async () => {
      try {
        const result = await closeRemainderAction(orderId, reason);
        if (result.ok) {
          toast.success(t("delivery.successClosed"));
          setCloseOpen(false);
          setCloseReason("");
          router.refresh();
          return;
        }
        toast.error(t(deliveryErrorKey(result.reason)));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Truck className="h-5 w-5" />
          {t("delivery.title")}
          <Badge
            variant={DELIVERY_BADGE_VARIANT[deliveryStatus]}
            className={DELIVERY_BADGE_CLASS[deliveryStatus]}
          >
            {t(statusKey)}
          </Badge>
        </CardTitle>
        {showActions && (
          <CardAction className={ACTION_SLOT_CLASS}>
            <Button
              className="h-10"
              disabled={isPending || !hasOutstanding}
              onClick={() => setFormOpen(true)}
            >
              <Truck className="h-4 w-4" />
              {t("delivery.create")}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              disabled={isPending || !hasOutstanding}
              onClick={() => setCloseOpen(true)}
            >
              {t("delivery.close")}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {deliveries.length === 0 ? (
          <div className="py-10 text-center">
            <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("delivery.empty")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("delivery.docNo")}</TableHead>
                <TableHead>{t("delivery.date")}</TableHead>
                <TableHead className="text-right">{t("delivery.qty")}</TableHead>
                <TableHead className="text-right">{t("delivery.value")}</TableHead>
                <TableHead>{t("delivery.deliveredBy")}</TableHead>
                <TableHead>{t("delivery.dueDate")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="font-mono whitespace-nowrap">{delivery.docNo}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(delivery.deliveredAt, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{totalQty(delivery)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {formatIDR(delivery.total)}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{delivery.deliveredByName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDay(delivery.dueDate, locale)}
                  </TableCell>
                  <TableCell className="w-12 text-right">
                    {/* per-row action slot — the delivery print buttons land here */}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <DeliveryFormDialog
        orderId={orderId}
        lines={lines}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <AlertDialog
        open={closeOpen}
        onOpenChange={(open) => {
          setCloseOpen(open);
          if (!open) setCloseReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delivery.closeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delivery.closeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="close-remainder-reason" className="text-xs text-muted-foreground">
              {t("delivery.closeReason")}
            </Label>
            <Textarea
              id="close-remainder-reason"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              disabled={isPending}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10" disabled={isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10"
              disabled={isPending || !closeReason.trim()}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; it closes on success. */
                e.preventDefault();
                callClose();
              }}
            >
              {isPending ? t("delivery.submitting") : t("delivery.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
