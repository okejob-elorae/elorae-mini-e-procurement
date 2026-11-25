"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import { getBillLinesForPo, getBillLinesForWo } from "@/app/actions/vendor-billing";
import type { LinkedBillLine } from "@/lib/vendor-billing/queries";
import type { VendorBillStatus } from "@/lib/vendor-billing/status";

/**
 * Read-only "Tagihan" card: vendor bills linked to a PO (full line detail + Pay) or a WO
 * (Bill, vendor invoice, vendor name, date, item, status — no qty/amount/Pay).
 * Hidden when none. A PO line that bills a specific receipt names its GRN; a receipt without a PO says so.
 */
export function LinkedBillLines({
  poId,
  woId,
  canPay,
}: {
  poId?: string;
  woId?: string;
  /** PO only: show Bayar when the viewer holds supplier_payments:create. */
  canPay?: boolean;
}) {
  const t = useTranslations("vendorBills");
  const tGrn = useTranslations("vendorBills.grn");
  const [lines, setLines] = useState<LinkedBillLine[]>([]);
  const summary = Boolean(woId) && !poId;

  useEffect(() => {
    const load = poId ? getBillLinesForPo(poId) : woId ? getBillLinesForWo(woId) : Promise.resolve([]);
    load.then(setLines).catch(() => setLines([]));
  }, [poId, woId]);

  const bayarPerBill = useMemo(() => {
    const map = new Map<string, { supplierId: string; href: string }>();
    if (!canPay || summary) return map;
    for (const l of lines) {
      if (l.status !== "UNPAID" && l.status !== "PARTIAL") continue;
      if (map.has(l.billId)) continue;
      map.set(l.billId, {
        supplierId: l.supplierId,
        href: `/backoffice/supplier-payments/baru?pemasok=${encodeURIComponent(l.supplierId)}&invoice=${encodeURIComponent(l.billId)}`,
      });
    }
    return map;
  }, [lines, canPay, summary]);

  if (lines.length === 0) return null;

  const statusLabel = (status: VendorBillStatus) => {
    // WO card: reviewer-facing labels (Billed / Partially Paid / Paid). PO keeps list labels.
    if (summary) {
      switch (status) {
        case "UNPAID":
          return t("linkedWoStatus.BILLED");
        case "PARTIAL":
          return t("linkedWoStatus.PARTIALLY_PAID");
        case "PAID":
          return t("linkedWoStatus.PAID");
        case "VOID":
          return t("linkedWoStatus.VOID");
        default: {
          const _exhaustive: never = status;
          return _exhaustive;
        }
      }
    }
    return t(`statusLabel.${status}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("linkedTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colBill")}</TableHead>
                <TableHead>{t("colVendorInvoice")}</TableHead>
                <TableHead>{t("supplier")}</TableHead>
                <TableHead>{t("colDate")}</TableHead>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead>{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link className="hover:underline" href={`/backoffice/vendor-bills/${l.billId}`}>
                      {l.billDocNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{l.vendorInvoiceNo}</TableCell>
                  <TableCell className="min-w-[140px] whitespace-normal">{l.supplierName}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.billDate}</TableCell>
                  <TableCell className="min-w-[160px] whitespace-normal">{l.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{statusLabel(l.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colBill")}</TableHead>
                <TableHead>{t("colVendorInvoice")}</TableHead>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead className="text-right">{t("colQty")}</TableHead>
                <TableHead className="text-right">{t("colAmount")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                {canPay ? <TableHead className="w-[1%] whitespace-nowrap" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const bayar = bayarPerBill.get(l.billId);
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link className="hover:underline" href={`/backoffice/vendor-bills/${l.billId}`}>
                        {l.billDocNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{l.vendorInvoiceNo}</TableCell>
                    <TableCell>
                      {l.label}
                      {l.grnDocNumber ? (
                        <span className="block text-xs text-muted-foreground">
                          {t("linkedGrn", { no: l.grnDocNumber })}
                          {l.tanpaPo ? ` · ${tGrn("tanpaPo")}` : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{l.qty.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatIDR(l.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{statusLabel(l.status)}</Badge>
                    </TableCell>
                    {canPay ? (
                      <TableCell>
                        {bayar ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={bayar.href}>{t("linkedBayar")}</Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
