"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreHorizontal, Printer, Truck } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/sales-orders/format";
import type { FieldSalesDeliveryStatus, FieldSalesOrderStatus } from "@/lib/field-sales/queries";
import type { OrderShipmentSummary } from "@/lib/delivery/shipment-queries";
import { closeRemainderAction } from "@/app/actions/field-sales-deliveries";
import { logPrint } from "@/app/actions/audit";
import { buildSuratKeluarPrintHtml } from "@/lib/print/konsi-surat-keluar-html";
import { printHtmlInIframe } from "@/lib/print/print-html-in-iframe";
import { deliveryErrorKey } from "./DeliveryFormDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { buildSuratKeluarLabels } from "./surat-keluar-labels";

type Props = {
  orderId: string;
  storeName: string;
  salesmanName: string;
  status: FieldSalesOrderStatus;
  deliveryStatus: FieldSalesDeliveryStatus;
  lines: Array<{ id: string; productName: string; variantLabel: string | null; outstanding: number }>;
  shipments: OrderShipmentSummary[];
  /**
   * A legacy order the previous consignment flow delivered in full at approve — no shipment, no
   * open qty, DELIVERED. Decided by the parent, which also scopes its own konsi note on it.
   */
  legacyDelivered: boolean;
  /** Whether that legacy order carries an approve-time transfer the header can print. */
  hasLegacyTransfer: boolean;
  canDeliver: boolean;
  canShipShipment: boolean;
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

const SHIPMENT_STATUS_BADGE: Record<OrderShipmentSummary["status"], string> = {
  PACKED: "bg-slate-100 text-slate-700",
  IN_TRANSIT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  PARTIALLY_DELIVERED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const STATUS_LABEL_KEY: Record<
  OrderShipmentSummary["status"],
  "statusPacked" | "statusInTransit" | "statusDelivered" | "statusPartiallyDelivered" | "statusCancelled"
> = {
  PACKED: "statusPacked",
  IN_TRANSIT: "statusInTransit",
  DELIVERED: "statusDelivered",
  PARTIALLY_DELIVERED: "statusPartiallyDelivered",
  CANCELLED: "statusCancelled",
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

function totalPlanned(shipment: OrderShipmentSummary): number {
  return shipment.lines.reduce((sum, line) => sum + line.plannedQty, 0);
}

/**
 * Only meaningful once every line on the shipment has actually been received — a shipment still
 * in transit carries a null `deliveredQty` on every line, and folding that into 0 would render a
 * completed-looking total for a shipment that has not moved any stock yet.
 */
function totalDelivered(shipment: OrderShipmentSummary): number | null {
  if (shipment.lines.some((line) => line.deliveredQty === null)) return null;
  return shipment.lines.reduce((sum, line) => sum + (line.deliveredQty ?? 0), 0);
}

export function KonsiShipmentsCard({
  orderId,
  storeName,
  salesmanName,
  status,
  deliveryStatus,
  lines,
  shipments,
  legacyDelivered,
  hasLegacyTransfer,
  canDeliver,
  canShipShipment,
}: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const tShipments = useTranslations("deliveryShipments");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createShipmentOpen, setCreateShipmentOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");

  if (status !== "APPROVED" && shipments.length === 0) return null;

  const hasOutstanding = lines.some((line) => line.outstanding > 0);
  /* The writer refuses a close while a shipment is PACKED or IN_TRANSIT (SHIPMENT_IN_FLIGHT). */
  const hasShipmentInFlight = shipments.some((s) => s.status === "PACKED" || s.status === "IN_TRANSIT");
  const closeBlocked = hasOutstanding && hasShipmentInFlight;
  const showActions = status === "APPROVED";
  const statusKey = `delivery.status.${deliveryStatus}`;
  const legacyDetailKey = hasLegacyTransfer
    ? "konsiShipments.legacyPrintFromHeader"
    : "konsiShipments.legacyNoTransfer";

  const handlePrint = async (shipment: OrderShipmentSummary) => {
    /* Its own entity type: the legacy header print logs "KonsiSuratKeluar" against the ORDER id. */
    await logPrint("KonsiShipmentSuratKeluar", shipment.id);
    const html = buildSuratKeluarPrintHtml({
      orderNo: shipment.docNo,
      storeName,
      salesmanName,
      approvedAt: shipment.packedAt,
      status: tShipments(STATUS_LABEL_KEY[shipment.status]),
      lines: shipment.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        variantLabel: lines.find((l) => l.id === line.orderLineId)?.variantLabel ?? null,
        qty: line.plannedQty,
      })),
      labels: buildSuratKeluarLabels(t as (key: string) => string),
    });
    printHtmlInIframe(html, t("print.suratKeluar"));
  };

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
          {t("konsiShipments.title")}
          <Badge
            variant={DELIVERY_BADGE_VARIANT[deliveryStatus]}
            className={DELIVERY_BADGE_CLASS[deliveryStatus]}
          >
            {t(statusKey)}
          </Badge>
        </CardTitle>
        {showActions && (
          <CardAction className={ACTION_SLOT_CLASS}>
            {canShipShipment && (
              <Button
                className="h-10"
                disabled={isPending || !hasOutstanding}
                onClick={() => setCreateShipmentOpen(true)}
              >
                <Truck className="h-4 w-4" />
                {tShipments("createShipment")}
              </Button>
            )}
            {canDeliver && (
              <Button
                variant="outline"
                className="h-10"
                disabled={isPending || !hasOutstanding || closeBlocked}
                title={closeBlocked ? t("konsiShipments.closeBlockedInFlight") : undefined}
                onClick={() => setCloseOpen(true)}
              >
                {t("delivery.close")}
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {!legacyDelivered && (
          <p className="mb-4 text-xs text-muted-foreground">{t("konsiShipments.note")}</p>
        )}
        {showActions && canDeliver && closeBlocked && (
          <p className="mb-4 text-xs text-muted-foreground">{t("konsiShipments.closeBlockedInFlight")}</p>
        )}
        {legacyDelivered ? (
          <div className="py-10 text-center">
            <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("konsiShipments.legacyDelivered")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(legacyDetailKey)}</p>
          </div>
        ) : shipments.length === 0 ? (
          <div className="py-10 text-center">
            <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("konsiShipments.empty")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("delivery.docNo")}</TableHead>
                <TableHead>{t("konsiShipments.colMethod")}</TableHead>
                <TableHead>{t("konsiShipments.colStatus")}</TableHead>
                <TableHead>{t("konsiShipments.colPackedAt")}</TableHead>
                <TableHead className="text-right">{t("konsiShipments.colPlanned")}</TableHead>
                <TableHead className="text-right">{t("konsiShipments.colDelivered")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((shipment) => {
                const delivered = totalDelivered(shipment);
                return (
                  <TableRow key={shipment.id}>
                    <TableCell className="font-mono whitespace-nowrap">{shipment.docNo}</TableCell>
                    <TableCell>
                      {shipment.method === "EXPEDITION"
                        ? tShipments("methodExpedition")
                        : tShipments("methodSalesmanCarry")}
                    </TableCell>
                    <TableCell>
                      <Badge className={SHIPMENT_STATUS_BADGE[shipment.status]}>
                        {tShipments(STATUS_LABEL_KEY[shipment.status])}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(shipment.packedAt, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{totalPlanned(shipment)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {delivered === null ? <span className="text-muted-foreground">—</span> : delivered}
                    </TableCell>
                    <TableCell className="w-12 text-right">
                      {/* A cancelled shipment has no action at all, so it gets no menu to open empty. */}
                      {shipment.status !== "CANCELLED" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={tCommon("actions")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handlePrint(shipment)}>
                              <Printer className="mr-2 h-4 w-4" />
                              {t("print.suratKeluar")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateShipmentDialog
        orderId={orderId}
        lines={lines}
        open={createShipmentOpen}
        onOpenChange={setCreateShipmentOpen}
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
            <Label htmlFor="konsi-close-remainder-reason" className="text-xs text-muted-foreground">
              {t("delivery.closeReason")}
            </Label>
            <Textarea
              id="konsi-close-remainder-reason"
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
