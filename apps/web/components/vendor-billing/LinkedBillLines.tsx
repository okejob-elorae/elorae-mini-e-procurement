"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import { getBillLinesForPo, getBillLinesForWo } from "@/app/actions/vendor-billing";
import type { LinkedBillLine } from "@/lib/vendor-billing/queries";

/** Read-only "Tagihan" card: the vendor bill lines on a PO's items or a WO's steps. Hidden when none. */
export function LinkedBillLines({ poId, woId }: { poId?: string; woId?: string }) {
  const t = useTranslations("vendorBills");
  const [lines, setLines] = useState<LinkedBillLine[]>([]);

  useEffect(() => {
    const load = poId ? getBillLinesForPo(poId) : woId ? getBillLinesForWo(woId) : Promise.resolve([]);
    load.then(setLines).catch(() => setLines([]));
  }, [poId, woId]);

  if (lines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("linkedTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colBill")}</TableHead>
              <TableHead>{t("colVendorInvoice")}</TableHead>
              <TableHead>{t("colItem")}</TableHead>
              <TableHead className="text-right">{t("colQty")}</TableHead>
              <TableHead className="text-right">{t("colAmount")}</TableHead>
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
                <TableCell>{l.label}</TableCell>
                <TableCell className="text-right">{l.qty.toLocaleString()}</TableCell>
                <TableCell className="text-right">{formatIDR(l.amount)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`statusLabel.${l.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
