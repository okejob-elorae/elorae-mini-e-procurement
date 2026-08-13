"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import type { FieldSalesOrderDetail, FieldSalesOrderStatus, KonsiSuggestion } from "@/lib/field-sales/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApproveRejectCard, type AppealedLine, type LineRef } from "./ApproveRejectCard";
import { DeliveriesCard } from "./DeliveriesCard";
import { KonsiSuggestionsCard, type StagedAddition } from "./KonsiSuggestionsCard";
import type { DeliverableLine } from "./DeliveryFormDialog";
import { logPrint } from "@/app/actions/audit";
import { buildSuratKeluarPrintHtml } from "@/lib/print/konsi-surat-keluar-html";

type Props = {
  order: FieldSalesOrderDetail;
  canApprove: boolean;
  canDeliver: boolean;
  konsiSuggestions: KonsiSuggestion[];
};

const STATUS_BADGE_VARIANT: Record<FieldSalesOrderStatus, "secondary" | "default" | "destructive"> = {
  PENDING_APPROVAL: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

const STATUS_LABEL_KEY: Record<FieldSalesOrderStatus, "statusPending" | "statusApproved" | "statusRejected"> = {
  PENDING_APPROVAL: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function printHtml(html: string, title: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", title);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => iframe.contentWindow?.print(), 350);
  }
  setTimeout(() => document.body.removeChild(iframe), 500);
}

export function FieldSalesOrderDetailClient({ order, canApprove, canDeliver, konsiSuggestions }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const locale = useLocale();
  const [stagedAdditions, setStagedAdditions] = useState<StagedAddition[]>([]);
  const isKonsi = order.orderType === "KONSI";
  const showMoney = !isKonsi || order.status === "APPROVED";
  const showKonsiSuggestions = isKonsi && order.status === "PENDING_APPROVAL" && canApprove;
  const shortLineCount = order.lines.filter((line) => line.qty > line.available).length;
  /**
   * Outstanding only means something once a putus order is approved and can be delivered.
   * Rejecting releases the reservation without cancelling the lines, so a rejected order
   * would otherwise report its full qty as still owed.
   */
  const showOutstanding = !isKonsi && order.status === "APPROVED";
  const lineColumnCount = 4 + (showOutstanding ? 1 : 0) + (showMoney ? 3 : 0);
  /**
   * Putus reserves at create and consumes at delivery, so `available` stays depressed by this
   * order's own reservation and would contradict the delivery dialog. Konsi reserves at approve
   * and never delivers, so `available` is the honest number there.
   */
  const stockLabel = isKonsi ? t("colAvailable") : t("colOnHand");
  const deliverableLines: DeliverableLine[] = order.lines.map((line) => ({
    id: line.id,
    productName: line.productName,
    variantLabel: line.variantLabel,
    variantSku: line.variantSku,
    outstanding: line.outstanding,
    onHand: line.onHand,
  }));
  const appealedLines: AppealedLine[] = order.lines
    .filter((line) => line.requestedUnitPrice != null)
    .map((line) => ({
      id: line.id,
      productName: line.productName,
      variantLabel: line.variantLabel,
      variantSku: line.variantSku,
      unitPrice: line.unitPrice,
      requestedUnitPrice: line.requestedUnitPrice as number,
      appealReason: line.appealReason,
    }));
  /*
   * Lets ApproveRejectCard resolve a short-stock line back to a product name for the
   * INSUFFICIENT_STOCK toast — the writer's ShortLine only carries (itemId, variantSku, available).
   */
  const orderLineRefs: LineRef[] = order.lines.map((line) => ({
    itemId: line.itemId,
    variantSku: line.variantSku,
    productName: line.productName,
    variantLabel: line.variantLabel,
  }));

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const handlePrintSuratKeluar = async () => {
    await logPrint("KonsiSuratKeluar", order.id);
    const html = buildSuratKeluarPrintHtml({
      orderNo: order.orderNo,
      storeName: order.storeName,
      salesmanName: order.salesmanName,
      approvedAt: order.approvedAt,
      status: order.status,
      lines: order.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        variantLabel: line.variantLabel,
        qty: line.qty,
      })),
      labels: {
        title: t("print.suratKeluarTitle"),
        doc: t("print.docLabel"),
        store: t("print.storeLabel"),
        salesman: t("print.salesmanLabel"),
        date: t("print.dateLabel"),
        status: t("print.statusLabel"),
        no: t("print.colNo"),
        product: t("print.colProduct"),
        qty: t("print.colQty"),
        consignmentNote: t("print.consignmentNote"),
        handedBy: t("print.handedBy"),
        receivedBy: t("print.receivedBy"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtml(html, t("print.suratKeluar"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/field-sales-orders">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold font-mono">{order.orderNo}</h1>
        <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
          {t(STATUS_LABEL_KEY[order.status])}
        </Badge>
        <Badge variant="outline">{isKonsi ? t("typeKonsi") : t("typePutus")}</Badge>
        {/* Putus notas now print per-delivery from DeliveriesCard; konsi has no deliveries in this slice. */}
        {isKonsi && order.status === "APPROVED" && (
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={handlePrintSuratKeluar}>
              <Printer className="h-4 w-4 mr-2" />
              {t("print.suratKeluar")}
            </Button>
          </div>
        )}
      </div>

      {showKonsiSuggestions && (
        <KonsiSuggestionsCard
          suggestions={konsiSuggestions}
          shortLineCount={shortLineCount}
          staged={stagedAdditions}
          onStagedChange={setStagedAdditions}
        />
      )}

      {canApprove && (
        <ApproveRejectCard
          orderId={order.id}
          status={order.status}
          canApprove={canApprove}
          orderType={order.orderType}
          appealedLines={appealedLines}
          orderLines={orderLineRefs}
          stagedAdditions={stagedAdditions}
          onStagedAdditionsChange={setStagedAdditions}
        />
      )}

      <DeliveriesCard
        orderId={order.id}
        orderNo={order.orderNo}
        storeName={order.storeName}
        salesmanName={order.salesmanName}
        orderType={order.orderType}
        status={order.status}
        deliveryStatus={order.deliveryStatus}
        deliveries={order.deliveries}
        lines={deliverableLines}
        paymentTempo={order.paymentTempo}
        canDeliver={canDeliver}
      />

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detailTitle")}</h2>
        <Field label={t("store")} value={order.storeName} />
        <Field label={t("salesman")} value={order.salesmanName} />
        <Field label={t("createdAt")} value={formatDate(order.createdAt)} />
        <Field label={t("approvedAt")} value={order.approvedAt ? formatDate(order.approvedAt) : null} />
        <Field label={t("rejectedAt")} value={order.rejectedAt ? formatDate(order.rejectedAt) : null} />
        <Field label={t("delivery.closedAt")} value={order.closedAt ? formatDate(order.closedAt) : null} />
        <Field label={t("note")} value={order.note} />
        {order.status === "REJECTED" && order.rejectReason && (
          <div className="pt-2 border-t">
            <div className="text-sm text-muted-foreground mb-1">{t("rejectReason")}</div>
            <div className="text-sm">{order.rejectReason}</div>
          </div>
        )}
        {order.closeReason && (
          <div className="pt-2 border-t">
            <div className="text-sm text-muted-foreground mb-1">{t("delivery.closeReasonLabel")}</div>
            <div className="text-sm">{order.closeReason}</div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        {isKonsi && <p className="text-xs text-muted-foreground mb-2">{t("konsiTransferNote")}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colProduct")}</TableHead>
              <TableHead>{t("colVariant")}</TableHead>
              <TableHead className="text-right">{t("colQty")}</TableHead>
              {showOutstanding && (
                <TableHead className="text-right">{t("delivery.outstanding")}</TableHead>
              )}
              <TableHead className="text-right">{stockLabel}</TableHead>
              {showMoney && (
                <>
                  <TableHead className="text-right">{t("colUnitPrice")}</TableHead>
                  <TableHead className="text-right">{t("colLineTotal")}</TableHead>
                  <TableHead className="text-right">{t("colDiscount")}</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((line) => (
              <Fragment key={line.id}>
                <TableRow>
                  <TableCell>
                    {line.productName}
                    {line.addedById != null && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-muted-foreground/30 text-muted-foreground align-middle"
                      >
                        {t("konsiSuggestions.addedByAdminBadge")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  {showOutstanding && (
                    <TableCell className="text-right tabular-nums">{line.outstanding}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {isKonsi ? line.available : line.onHand}
                  </TableCell>
                  {showMoney && (
                    <>
                      <TableCell className="text-right">{formatRupiah(line.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(line.lineTotal)}</TableCell>
                      <TableCell className="text-right">
                        {line.discountAmount > 0 ? formatRupiah(line.discountAmount) : "—"}
                        {line.appliedPromoName && (
                          <div className="text-xs text-muted-foreground">{line.appliedPromoName}</div>
                        )}
                      </TableCell>
                    </>
                  )}
                </TableRow>
                {line.requestedUnitPrice != null && (
                  <TableRow className="border-0 bg-amber-500/5 hover:bg-amber-500/5">
                    <TableCell colSpan={lineColumnCount} className="py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                          {t("appealBadge")}
                        </Badge>
                        <span className="text-muted-foreground">
                          {t("appealStorePrice")}:{" "}
                          <span className="font-medium text-foreground tabular-nums">{formatRupiah(line.unitPrice)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          {t("appealRequestedPrice")}:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {formatRupiah(line.requestedUnitPrice)}
                          </span>
                        </span>
                        {line.appealReason && (
                          <span className="text-muted-foreground italic">
                            {t("appealReasonLabel")}: {line.appealReason}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>

        {showMoney && (
          <div className="mt-3 flex flex-col items-end gap-1 text-sm">
            <div className="flex w-56 justify-between">
              <span className="text-muted-foreground">{t("subtotal")}</span>
              <span>{formatRupiah(order.subtotal)}</span>
            </div>
            {order.orderDiscountAmount > 0 && (
              <div className="flex w-56 justify-between">
                <span className="text-muted-foreground">{t("orderDiscount")}</span>
                <div className="text-right">
                  −{formatRupiah(order.orderDiscountAmount)}
                  {order.appliedOrderPromoName && (
                    <div className="text-xs text-muted-foreground">{order.appliedOrderPromoName}</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex w-56 justify-between border-t pt-1 font-semibold">
              <span>{t("total")}</span>
              <span>{formatRupiah(order.total)}</span>
            </div>
          </div>
        )}

        {isKonsi && order.status === "APPROVED" && (order.marginPercent === null || order.marginPercent < 0 || order.marginPercent >= 100) && (
          <p className="mt-2 text-right text-xs text-amber-600">{t("konsiMarginUnset")}</p>
        )}

        {showMoney && order.lines.some((line) => line.belowCost) && (
          <p className="mt-2 text-right text-xs text-amber-600">{t("promoBelowCost")}</p>
        )}
      </Card>
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
