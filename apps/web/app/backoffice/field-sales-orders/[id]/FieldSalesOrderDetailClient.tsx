"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import type { FieldSalesOrderDetail, FieldSalesOrderStatus } from "@/lib/field-sales/queries";
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
import { ApproveRejectCard } from "./ApproveRejectCard";
import { logPrint } from "@/app/actions/audit";
import { buildNotaGudangPrintHtml } from "@/lib/print/field-sales-nota-gudang-html";
import { buildNotaTagihanPrintHtml } from "@/lib/print/field-sales-nota-tagihan-html";
import { buildSuratKeluarPrintHtml } from "@/lib/print/konsi-surat-keluar-html";

type Props = {
  order: FieldSalesOrderDetail;
  canApprove: boolean;
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

export function FieldSalesOrderDetailClient({ order, canApprove }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const locale = useLocale();
  const isKonsi = order.orderType === "KONSI";
  const showMoney = !isKonsi || order.status === "APPROVED";

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const handlePrintGudang = async () => {
    await logPrint("FieldSalesNotaGudang", order.id);
    const html = buildNotaGudangPrintHtml({
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
        title: t("print.gudangTitle"),
        doc: t("print.docLabel"),
        store: t("print.storeLabel"),
        salesman: t("print.salesmanLabel"),
        date: t("print.dateLabel"),
        status: t("print.statusLabel"),
        no: t("print.colNo"),
        product: t("print.colProduct"),
        qty: t("print.colQty"),
        preparedBy: t("print.preparedBy"),
        receivedBy: t("print.receivedBy"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtml(html, t("print.notaGudang"));
  };

  const handlePrintTagihan = async () => {
    await logPrint("FieldSalesNotaTagihan", order.id);
    const html = buildNotaTagihanPrintHtml({
      orderNo: order.orderNo,
      storeName: order.storeName,
      salesmanName: order.salesmanName,
      approvedAt: order.approvedAt,
      subtotal: order.subtotal,
      orderDiscountAmount: order.orderDiscountAmount,
      appliedOrderPromoName: order.appliedOrderPromoName,
      total: order.total,
      lines: order.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        variantLabel: line.variantLabel,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        discountAmount: line.discountAmount,
        appliedPromoName: line.appliedPromoName,
      })),
      labels: {
        title: t("print.tagihanTitle"),
        doc: t("print.docLabel"),
        store: t("print.storeLabel"),
        salesman: t("print.salesmanLabel"),
        date: t("print.dateLabel"),
        no: t("print.colNo"),
        product: t("print.colProduct"),
        qty: t("print.colQty"),
        price: t("print.colPrice"),
        discount: t("print.colDiscount"),
        lineTotal: t("print.colLineTotal"),
        subtotal: t("print.subtotal"),
        orderDiscount: t("print.orderDiscount"),
        grandTotal: t("print.grandTotal"),
        regards: t("print.regards"),
        receivedBy: t("print.receivedBy"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtml(html, t("print.notaTagihan"));
  };

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
        {order.status === "APPROVED" && (
          <div className="flex items-center gap-2 ml-auto">
            {isKonsi ? (
              <Button variant="outline" size="sm" onClick={handlePrintSuratKeluar}>
                <Printer className="h-4 w-4 mr-2" />
                {t("print.suratKeluar")}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handlePrintGudang}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t("print.notaGudang")}
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrintTagihan}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t("print.notaTagihan")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {canApprove && (
        <ApproveRejectCard
          orderId={order.id}
          status={order.status}
          canApprove={canApprove}
          orderType={order.orderType}
        />
      )}

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detailTitle")}</h2>
        <Field label={t("store")} value={order.storeName} />
        <Field label={t("salesman")} value={order.salesmanName} />
        <Field label={t("createdAt")} value={formatDate(order.createdAt)} />
        <Field label={t("approvedAt")} value={order.approvedAt ? formatDate(order.approvedAt) : null} />
        <Field label={t("rejectedAt")} value={order.rejectedAt ? formatDate(order.rejectedAt) : null} />
        <Field label={t("note")} value={order.note} />
        {order.status === "REJECTED" && order.rejectReason && (
          <div className="pt-2 border-t">
            <div className="text-sm text-muted-foreground mb-1">{t("rejectReason")}</div>
            <div className="text-sm">{order.rejectReason}</div>
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
              <TableHead className="text-right">{t("colAvailable")}</TableHead>
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
              <TableRow key={line.id}>
                <TableCell>{line.productName}</TableCell>
                <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                <TableCell className="text-right">{line.qty}</TableCell>
                <TableCell className="text-right">{line.available}</TableCell>
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
