"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { formatIDR } from "@/lib/sales-orders/format";
import type { getVendorBillDetail } from "@/lib/vendor-billing/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BILL_STATUS_VARIANT } from "../status-variant";
import { VoidBillButton } from "./VoidBillButton";

type Bill = NonNullable<Awaited<ReturnType<typeof getVendorBillDetail>>>;

const day = (d: Date | string) => new Date(d).toLocaleDateString("id-ID");

export function VendorBillDetailClient({ bill, canVoid, userId }: { bill: Bill; canVoid: boolean; userId: string }) {
  const t = useTranslations("vendorBills");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/backoffice/vendor-bills">
          <Button variant="ghost" size="icon" aria-label={t("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{bill.docNumber}</h1>
          <p className="text-muted-foreground">
            {bill.supplier.name} · {t("vendorInvoiceNo")} {bill.vendorInvoiceNo}
          </p>
        </div>
        <Badge className="ml-auto" variant={BILL_STATUS_VARIANT[bill.status]}>
          {t(`statusLabel.${bill.status}`)}
        </Badge>
        {canVoid && <VoidBillButton billId={bill.id} userId={userId} />}
      </div>

      {bill.status === "VOID" && (
        <Card>
          <CardContent className="pt-6 text-sm">
            {t("voidedOn", { date: bill.voidedAt ? day(bill.voidedAt) : "-" })}: {bill.voidReason}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-muted-foreground">{t("billDate")}</p>
            <p>{day(bill.billDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("dueDate")}</p>
            <p>{bill.dueDate ? day(bill.dueDate) : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("colTotal")}</p>
            <p className="font-medium">{formatIDR(bill.total)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("colPaid")}</p>
            <p>{formatIDR(bill.paidAmount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("outstanding")}</p>
            <p>{formatIDR(bill.status === "VOID" ? 0 : bill.total - bill.paidAmount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("createdBy")}</p>
            <p>{bill.createdBy.name ?? "-"}</p>
          </div>
          {bill.notes && (
            <div className="sm:col-span-3 lg:col-span-6">
              <p className="text-muted-foreground">{t("notes")}</p>
              <p className="whitespace-pre-wrap">{bill.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("linesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colSource")}</TableHead>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead className="text-right">{t("colQty")}</TableHead>
                <TableHead className="text-right">{t("colPrice")}</TableHead>
                <TableHead className="text-right">{t("colAmount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.poItem ? (
                      <Link className="hover:underline" href={`/backoffice/purchase-orders/${l.poItem.po.id}`}>
                        {l.poItem.po.docNumber}
                      </Link>
                    ) : l.woStep ? (
                      <Link className="hover:underline" href={`/backoffice/work-orders/${l.woStep.wo.id}`}>
                        {l.woStep.wo.docNumber}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    {l.poItem
                      ? `${l.poItem.item.nameId}${l.poItem.variantSku ? ` · ${l.poItem.variantSku}` : ""}`
                      : l.woStep
                        ? `${t("step")} ${l.woStep.sequence}${l.woStep.stepName ? ` · ${l.woStep.stepName}` : ""}`
                        : "-"}
                  </TableCell>
                  <TableCell className="text-right">{l.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {formatIDR(l.price)}
                    {Math.abs(l.price - l.refPrice) > 0.005 && (
                      <Badge variant="secondary" className="ml-2">
                        {t("variance", { ref: formatIDR(l.refPrice) })}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatIDR(l.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("paymentsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {bill.allocations.length === 0 ? (
              <p className="text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="space-y-1">
                {bill.allocations.map((a) => (
                  <li key={a.id} className={a.payment.voidedAt ? "text-muted-foreground line-through" : ""}>
                    {a.payment.docNumber} · {day(a.payment.paidAt)} · {formatIDR(a.amount)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("journalsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {bill.journals.length === 0 ? (
              <p className="text-muted-foreground">{t("noJournal")}</p>
            ) : (
              <ul className="space-y-1">
                {bill.journals.map((j) => (
                  <li key={j.id}>
                    <Link className="hover:underline" href={`/backoffice/finance/journals/${j.id}`}>
                      {j.sourceType} · {day(j.date)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
