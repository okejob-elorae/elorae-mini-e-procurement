"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, CloudOff, ExternalLink, MapPin, Printer } from "lucide-react";
import type { SpgSaleDetail } from "@/lib/spg/sale-queries";
import type { KembaliPerNota } from "@/lib/spg/retur-pembeli";
import { dinamis } from "@/lib/i18n/dinamis";
import { rincianNotaSpg, spgSaleNotaHtml } from "@/lib/print/spg-sale-nota-html";
import { formatDisplayDateTime } from "@/lib/date-only";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";

type Props = {
  sale: SpgSaleDetail;
  /** Barang yang sudah dikembalikan pembeli ke counter (uangnya lewat kasir toko). */
  kembali?: KembaliPerNota;
};


function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Baris uang ringkasan; potongan ditulis dengan tanda minus. Uang tidak pernah dipotong. */
function Uang({ label, nilai, potongan = false, kuat = false }: { label: string; nilai: number; potongan?: boolean; kuat?: boolean }) {
  return (
    <div className={kuat ? "flex justify-between gap-4 text-sm font-semibold" : "flex justify-between gap-4 text-sm"}>
      <span className={kuat ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{potongan ? `−${formatRupiah(nilai)}` : formatRupiah(nilai)}</span>
    </div>
  );
}

/** "62812…" (bentuk tersimpan) → "0812…" untuk dibaca orang. */
function tampilHp(hp: string): string {
  return hp.startsWith("62") ? `0${hp.slice(2)}` : hp;
}

export function SpgSaleDetailClient({ sale, kembali }: Props) {
  const t = useTranslations("spgSale.backoffice.detail");
  const tSpgSale = useTranslations("spgSale");
  const tk = useTranslations("spgRetur.kantor");
  const tKondisi = dinamis(useTranslations("spgRetur"));
  const locale = useLocale();
  const adaKembali = (kembali?.riwayat.length ?? 0) > 0;
  const rincian = rincianNotaSpg(sale);

  function handlePrint() {
    const html = spgSaleNotaHtml(sale);
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
            <Link href="/backoffice/spg-sales">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {tSpgSale("back")}
            </Link>
          </Button>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold font-mono">{sale.docNo}</h1>
            <TombolBantuan judul={sale.docNo} />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          {tSpgSale("printButton")}
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("summaryTitle")}</h2>
        <Field label={t("salesmanLabel")} value={sale.salesmanLabel} />
        <Field label={t("storeLabel")} value={sale.storeName} />
        <Field label={t("dateLabel")} value={formatDisplayDateTime(sale.createdAtIso, locale)} />
        {sale.capturedOffline && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Badge variant="secondary" className="gap-1">
              <CloudOff className="h-3 w-3" aria-hidden />
              {t("offlineBadge")}
            </Badge>
            <span className="text-right text-muted-foreground">
              {sale.syncedAtIso ? t("syncedAt", { time: formatDisplayDateTime(sale.syncedAtIso, locale) }) : t("offlineHint")}
            </span>
          </div>
        )}
        {sale.customer && <Field label={t("customerLabel")} value={`${sale.customer.name} · ${tampilHp(sale.customer.phone)}`} />}
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
          {rincian.potonganTotal > 0 && (
            <>
              <Uang label={t("subtotalLabel")} nilai={rincian.subtotal} />
              {rincian.promoBarang > 0 && <Uang label={t("itemPromoLabel")} nilai={rincian.promoBarang} potongan />}
              {rincian.diskonMember && (
                <Uang label={t("memberDiscountLabel", { tingkat: rincian.diskonMember.tingkat })} nilai={rincian.diskonMember.potongan} potongan />
              )}
              {rincian.promoBelanja && (
                <Uang label={t("orderPromoLabel", { name: rincian.promoBelanja.nama })} nilai={rincian.promoBelanja.potongan} potongan />
              )}
              {rincian.diskonSpg > 0 && <Uang label={t("manualDiscountLabel")} nilai={rincian.diskonSpg} potongan />}
              {rincian.diskonSpg > 0 && sale.manualDiscountReason && (
                <p className="text-xs text-muted-foreground">{t("manualReason", { reason: sale.manualDiscountReason })}</p>
              )}
            </>
          )}
          <Uang label={tSpgSale("totalLabel")} nilai={sale.total} kuat />
          {/* Pembeli membayar di kasir toko. Hanya nota lama yang benar-benar mencatat kembalian menampilkan uang tunai. */}
          {sale.changeGiven > 0 ? (
            <>
              <Uang label={tSpgSale("cashTenderedLabel")} nilai={sale.cashReceived} />
              <Uang label={tSpgSale("changeLabel")} nilai={sale.changeGiven} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("paidAtCashier")}</p>
          )}
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
                <TableHead>{t("table.promo")}</TableHead>
                <TableHead className="text-right">{t("table.discount")}</TableHead>
                <TableHead className="text-right">{t("table.lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.lines.map((line, i) => (
                <TableRow key={i}>
                  <TableCell className="min-w-[12rem] whitespace-normal">{line.productName}</TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right">{line.qty}</TableCell>
                  <TableCell className="text-right">{formatRupiah(line.unitPrice)}</TableCell>
                  <TableCell className="min-w-[8rem] whitespace-normal text-muted-foreground">{line.promoName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {line.discount > 0 ? `−${formatRupiah(line.discount)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatRupiah(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {kembali && adaKembali && (
        <Card className="p-4 space-y-4">
          <h2 className="font-semibold">{tk("judul")}</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.product")}</TableHead>
                  <TableHead>{t("table.variant")}</TableHead>
                  <TableHead className="text-right">{tk("terjual")}</TableHead>
                  <TableHead className="text-right">{tk("kembali")}</TableHead>
                  <TableHead className="text-right">{tk("bersih")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kembali.perBaris.map((b) => (
                  <TableRow key={b.saleLineId}>
                    <TableCell className="min-w-[12rem] whitespace-normal">{b.productName}</TableCell>
                    <TableCell className="font-mono text-sm">{b.variantSku || "—"}</TableCell>
                    <TableCell className="text-right">{b.qty}</TableCell>
                    <TableCell className="text-right">{b.returnedQty > 0 ? b.returnedQty : "—"}</TableCell>
                    <TableCell className="text-right">{b.qty - b.returnedQty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-3">
            {kembali.riwayat.map((r) => (
              <li key={r.id} className="space-y-1 border-t pt-3 text-sm">
                <p className="font-medium">
                  {formatDisplayDateTime(r.waktu, locale)} · {r.oleh}
                </p>
                <p className="text-muted-foreground">{tk("alasan", { alasan: r.alasan })}</p>
                <p>
                  {r.baris
                    .map((x) => `${x.qty}× ${x.productName}${x.variantSku ? ` (${x.variantSku})` : ""} — ${tKondisi(`kondisi${x.condition}`)}`)
                    .join("; ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
