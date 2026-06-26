"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
import { formatIDR, formatDateTime } from "@/lib/sales-orders/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FulfillmentCard } from "./FulfillmentCard";

type Props = {
  order: SalesOrderDetail;
  items: SalesOrderItemRow[];
  canFulfill: boolean;
  lineImages?: Record<string, string>;
};

const KNOWN_FEE_KEYS = new Set([
  "insurance_cost",
  "add_fee",
  "add_disc",
  "service_fee",
  "escrow_amount",
  "voucher_amount",
  "cod_fee",
  "order_processing_fee",
  "shipping_tax",
  "total_amount_mp",
]);

export function SalesOrderDetailClient({ order, items, canFulfill, lineImages = {} }: Props) {
  const t = useTranslations("salesOrders");
  const locale = useLocale();

  const feeEntries = order.feeBreakdown
    ? Object.entries(order.feeBreakdown).filter(([, v]) => v && v !== "0")
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/sales-orders"><ArrowLeft className="h-4 w-4 mr-2" />{t("detail.back")}</Link>
        </Button>
        <h1 className="text-2xl font-semibold font-mono">{order.salesorderNo}</h1>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[order.channel].tailwindClass}`}>
          {t(`channel.${CHANNEL_BADGE[order.channel].labelKey}` as never)}
        </span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[order.status].tailwindClass}`}>
          {t(`status.${order.status}` as never)}
        </span>
      </div>

      <FulfillmentCard
        orderId={order.id}
        fulfillmentStatus={order.fulfillmentStatus}
        isLocked={order.isCanceled || order.status === "CANCELLED" || order.status === "RETURNED"}
        canFulfill={canFulfill}
        pickedAt={order.pickedAt}
        pickedByName={order.pickedByName}
        packedAt={order.packedAt}
        packedByName={order.packedByName}
        shippedAt={order.shippedAt}
        shippedByName={order.shippedByName}
        trackingNumber={order.trackingNumber}
        courierName={order.courierName}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.buyer")}</h2>
          <Field label={t("detail.field.customerName")} value={order.customerName} />
          <Field label={t("detail.field.customerPhone")} value={order.customerPhone} />
          <Field label={t("detail.field.customerEmail")} value={order.customerEmail} />
          {order.shippingAddress && (
            <div className="pt-2 border-t">
              <div className="text-sm text-muted-foreground mb-1">{t("detail.field.shippingAddress")}</div>
              <ShippingBlock addr={order.shippingAddress} />
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.orderMeta")}</h2>
          <Field label={t("detail.field.transactionDate")} value={formatDateTime(order.transactionDate, locale)} />
          <Field label={t("detail.field.paymentMethod")} value={order.paymentMethod} />
          <Field label={t("detail.field.paymentDate")} value={order.paymentDate ? formatDateTime(order.paymentDate, locale) : null} />
          <Field label={t("detail.field.courier")} value={order.courier} />
          <Field label={t("detail.field.trackingNumber")} value={order.trackingNumber} />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">{t("detail.section.lineItems")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{t("detail.lineCol.sku")}</TableHead>
              <TableHead>{t("detail.lineCol.product")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.qty")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.unitPrice")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.discount")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.lineTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const imgKey = it.itemId ? `${it.itemId}|` : null;
              const imgUrl = imgKey ? lineImages[imgKey] : undefined;
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt=""
                        className="w-10 h-10 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {it.itemId
                      ? <Link href={`/backoffice/items/${it.itemId}`} className="hover:underline">{it.jubelioItemCode}</Link>
                      : it.jubelioItemCode}
                  </TableCell>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell className="text-right">{it.qty}</TableCell>
                  <TableCell className="text-right">{formatIDR(it.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatIDR(it.discAmount)}</TableCell>
                  <TableCell className="text-right">{formatIDR(it.lineTotal)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.totals")}</h2>
          <Field label={t("detail.field.subTotal")} value={formatIDR(order.subTotal)} />
          <Field label={t("detail.field.totalDisc")} value={formatIDR(order.totalDisc)} />
          <Field label={t("detail.field.totalTax")} value={formatIDR(order.totalTax)} />
          <Field label={t("detail.field.shippingCost")} value={formatIDR(order.shippingCost)} />
          <div className="pt-2 border-t flex justify-between font-semibold">
            <span>{t("detail.field.grandTotal")}</span>
            <span>{formatIDR(order.grandTotal)}</span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.rawStatus")}</h2>
          <Field label={t("detail.field.channelStatus")} value={order.channelStatus} />
          <Field label={t("detail.field.internalStatus")} value={order.internalStatus} />
          <Field label={t("detail.field.wmsStatus")} value={order.wmsStatus} />
          <Field label={t("detail.field.isCanceled")} value={order.isCanceled ? t("yes") : t("no")} />
          <Field label={t("detail.field.isPaid")} value={order.isPaid ? t("yes") : t("no")} />
          <Field label={t("detail.field.markedAsComplete")} value={order.markedAsComplete ? t("yes") : t("no")} />
        </Card>
      </div>

      {feeEntries.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.feeBreakdown")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {feeEntries.map(([key, value]) => (
              <Field
                key={key}
                label={KNOWN_FEE_KEYS.has(key) ? t(`fee.${key}` as never) : key}
                value={formatIDR(value)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ShippingBlock({ addr }: { addr: Record<string, string | null> }) {
  const lines: string[] = [];
  if (addr.full_name) lines.push(addr.full_name);
  if (addr.phone) lines.push(addr.phone);
  if (addr.address) lines.push(addr.address);
  const cityProvince = [addr.city, addr.province].filter(Boolean).join(", ");
  if (cityProvince) lines.push(cityProvince);
  if (addr.post_code) lines.push(addr.post_code);
  if (addr.country) lines.push(addr.country);
  return (
    <div className="text-sm whitespace-pre-line">
      {lines.join("\n")}
    </div>
  );
}
