"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDisplayDateTime } from "@/lib/date-only";
import type { BarisSelisihHarga } from "@/lib/vendor-billing/koreksi-utang-queries";
import type { KonteksKoreksi } from "@/lib/vendor-billing/koreksi-utang-konteks";
import { PutuskanSelisihDialog, type KoreksiUntukDialog } from "../_bersama/PutuskanSelisihDialog";

const VARIAN: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  MENUNGGU: "secondary",
  DITERIMA: "default",
  INVOICE_DIKOREKSI: "outline",
  DIBATALKAN: "outline",
};

/**
 * Kartu "Selisih harga invoice" di rincian tagihan (keputusan pemilik 2026-11-02, P27, P49, P50, P53).
 * Tombol Putuskan hanya bagi pemegang `vendor_bills:decide_price` (izin yang sama dengan aksinya).
 */
export function KoreksiUtangCard({
  koreksi,
  konteks,
  qtyBaris,
  canDecide,
  peranBelumDipetakan,
}: {
  koreksi: BarisSelisihHarga[];
  konteks: Record<string, KonteksKoreksi>;
  /** Qty baris tagihan per id baris, untuk mengenali baris yang ikut membukukan ongkos jahit lama. */
  qtyBaris: Record<string, number>;
  canDecide: boolean;
  peranBelumDipetakan: string[];
}) {
  const t = useTranslations("vendorBills.selisih");
  const locale = useLocale();
  const [pilih, setPilih] = useState<KoreksiUntukDialog | null>(null);
  if (koreksi.length === 0) return null;
  const adaMenunggu = koreksi.some((k) => k.status === "MENUNGGU");

  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          {t("kartuJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-6">
        {adaMenunggu && <p className="text-sm text-muted-foreground">{t("kartuIsi")}</p>}
        {adaMenunggu && canDecide && peranBelumDipetakan.length > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{t("peranBelumDipetakan", { peran: peranBelumDipetakan.join(", ") })}</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolomPenerimaan")}</TableHead>
                <TableHead className="text-right">{t("kolomQty")}</TableHead>
                <TableHead className="text-right">{t("kolomHargaTercatat")}</TableHead>
                <TableHead className="text-right">{t("kolomHargaInvoice")}</TableHead>
                <TableHead className="text-right">{t("kolomSelisihUtang")}</TableHead>
                <TableHead>{t("kolomStatus")}</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {koreksi.map((k) => {
                const kx = konteks[k.id];
                const adaCmtLama = k.sourceType === "WO_STEP" && (qtyBaris[k.billLineId] ?? k.lineQty) - k.qty > 0.005;
                return (
                  <TableRow key={k.id}>
                    <TableCell className="align-top whitespace-normal">
                      <div className="font-medium">{k.penerimaan}</div>
                      <div className="text-xs text-muted-foreground">
                        {k.barang}
                        {k.variantSku ? ` · ${k.variantSku}` : ""}
                        {k.poNomor ? ` · ${k.poNomor}` : ""}
                      </div>
                      {k.status === "MENUNGGU" && kx?.poDitandaiLunas && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("poTombolLama")}</p>
                      )}
                      {k.barangDiretur > 0 && (k.status === "MENUNGGU" || k.status === "DITERIMA") && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          {t(k.status === "MENUNGGU" ? "direturMenunggu" : "direturDiterima", { qty: k.barangDiretur.toLocaleString("id-ID") })}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right">{k.qty.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="align-top text-right">{formatIDR(k.recordedPrice)}</TableCell>
                    <TableCell className="align-top text-right">{formatIDR(k.invoicePrice)}</TableCell>
                    <TableCell className="align-top text-right whitespace-normal">
                      <div className="font-medium">{k.amount > 0 ? "+" : "−"}{formatIDR(Math.abs(k.amount))}</div>
                      {k.ppnInputAmount !== 0 && <div className="text-xs text-muted-foreground">{t("bagianPpn", { nilai: formatIDR(Math.abs(k.ppnInputAmount)) })}</div>}
                      {k.status === "DITERIMA" && k.stockAmount != null && (
                        <div className="text-xs text-muted-foreground">
                          {t("bagianStok", { stok: formatIDR(Math.abs(k.stockAmount)), keluar: formatIDR(Math.abs(k.soldAmount ?? 0)) })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <Badge variant={VARIAN[k.status] ?? "outline"}>{t(`status.${k.status}`)}</Badge>
                      {k.decidedAt && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("diputuskanOleh", { nama: k.decidedBy ?? "—", waktu: formatDisplayDateTime(k.decidedAt, locale) })}
                        </div>
                      )}
                      {k.decisionNote && <div className="text-xs text-muted-foreground">{k.decisionNote}</div>}
                      {k.cancelReason && <div className="text-xs text-muted-foreground">{k.cancelReason}</div>}
                    </TableCell>
                    <TableCell className="align-top">
                      {k.status === "MENUNGGU" && canDecide && !k.billVoid && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPilih({
                              id: k.id,
                              vendorInvoiceNo: k.vendorInvoiceNo,
                              penerimaan: k.penerimaan,
                              barang: k.barang,
                              qty: k.qty,
                              recordedPrice: k.recordedPrice,
                              invoicePrice: k.invoicePrice,
                              amount: k.amount,
                              adaCmtLama,
                              adaRetur: k.barangDiretur > 0,
                              dibayarSen: kx?.dibayarSen ?? null,
                              utangSen: kx?.utangSen ?? null,
                            })
                          }
                        >
                          {t("putuskan")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <PutuskanSelisihDialog koreksi={pilih} onClose={() => setPilih(null)} />
    </Card>
  );
}
