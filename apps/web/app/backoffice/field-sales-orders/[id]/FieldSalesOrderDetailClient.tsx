"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
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
            <div className="flex w-56 justify-between border-t pt-1 font-semibold">
              <span>{t("total")}</span>
              <span>{formatRupiah(order.total)}</span>
            </div>
          </div>
        )}

        {isKonsi && order.status === "APPROVED" && (order.marginPercent === null || order.marginPercent >= 100) && (
          <p className="mt-2 text-right text-xs text-amber-600">{t("konsiMarginUnset")}</p>
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
