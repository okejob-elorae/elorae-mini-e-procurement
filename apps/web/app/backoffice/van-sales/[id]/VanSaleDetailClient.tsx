"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink, MapPin, Printer } from "lucide-react";
import type { VanSaleDetail } from "@/lib/canvassing/sale-queries";
import { vanSaleNotaHtml } from "@/lib/print/van-sale-nota-html";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  sale: VanSaleDetail;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export function VanSaleDetailClient({ sale }: Props) {
  const t = useTranslations("vanSale.backoffice.detail");
  const tVanSale = useTranslations("vanSale");

  function handlePrint() {
    const html = vanSaleNotaHtml(sale);
    const win = window.open("", "_blank", "width=360,height=640");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${sale.docNo}</title></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 250);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/van-sales">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {tVanSale("back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{sale.docNo}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          {tVanSale("printButton")}
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("summaryTitle")}</h2>
        <Field label={t("salesmanLabel")} value={sale.salesmanLabel} />
        <Field label={t("buyerLabel")} value={sale.storeName ?? sale.buyerName ?? t("buyerWalkIn")} />
        <Field label={t("buyerPhoneLabel")} value={sale.buyerPhone} />
        <Field label={t("dateLabel")} value={formatDateTime(sale.createdAtIso)} />
        {sale.saleLat !== null && sale.saleLng !== null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("gpsLabel")}</span>
            <a
              href={`https://www.google.com/maps?q=${sale.saleLat},${sale.saleLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              <MapPin className="h-3 w-3" />
              {t("openInMaps")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        <Field label={t("noteLabel")} value={sale.note} />
        <div className="pt-2 border-t space-y-1">
          <div className="flex justify-between text-sm font-semibold">
            <span>{tVanSale("totalLabel")}</span>
            <span>{formatRupiah(sale.total)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{tVanSale("cashTenderedLabel")}</span>
            <span>{formatRupiah(sale.amountPaid)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{tVanSale("changeLabel")}</span>
            <span>{formatRupiah(sale.changeAmount)}</span>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.product")}</TableHead>
                <TableHead>{t("table.variant")}</TableHead>
                <TableHead className="text-right">{t("table.qty")}</TableHead>
                <TableHead className="text-right">{t("table.unitPrice")}</TableHead>
                <TableHead className="text-right">{t("table.unitCost")}</TableHead>
                <TableHead className="text-right">{t("table.lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.lines.map((line, i) => (
                <TableRow key={i}>
                  <TableCell>{line.productName}</TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right">{line.qty}</TableCell>
                  <TableCell className="text-right">{formatRupiah(line.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatRupiah(line.unitCost)}</TableCell>
                  <TableCell className="text-right">{formatRupiah(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
