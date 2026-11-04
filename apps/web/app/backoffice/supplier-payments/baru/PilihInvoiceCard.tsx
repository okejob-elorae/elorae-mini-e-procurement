"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import type { DataBayarInvoice } from "@/lib/vendor-billing/invoice-bayar-queries";
import type { isiDariInvoice, ringkasInvoiceTerpilih } from "@/lib/purchasing/bayar-dari-invoice";

/**
 * "Bayar per invoice" (Q19; P20; P29): invoice terbuka pemasok, tertua dulu menurut tanggal invoice.
 * Mencentang mengisi penerimaan yang disebutnya sebesar utang tercatat, tidak pernah sebesar angka
 * invoice. Tautan ke tagihannya hanya bagi pembaca tagihan (`vendor_bills:view`).
 */
export function PilihInvoiceCard({
  data,
  dipilih,
  onUbah,
  isi,
  ringkas,
  invoiceLunasDariUrl,
  bolehBukaTagihan,
}: {
  data: DataBayarInvoice;
  dipilih: Set<string>;
  onUbah: (next: Set<string>) => void;
  isi: ReturnType<typeof isiDariInvoice>;
  ringkas: ReturnType<typeof ringkasInvoiceTerpilih>;
  invoiceLunasDariUrl: string | null;
  bolehBukaTagihan: boolean;
}) {
  const t = useTranslations("supplierPayments.dokumen.invoice");
  const locale = useLocale();
  const nomorPenerimaan = new Map(data.penerimaan.map((p) => [p.kunci, p.nomor]));
  if (data.invoice.length === 0 && !invoiceLunasDariUrl) return null;

  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <p className="text-sm text-muted-foreground">{t("isi")}</p>
        {invoiceLunasDariUrl && <p className="text-sm">{t("sudahLunas", { nomor: invoiceLunasDariUrl })}</p>}
        <ul className="space-y-3">
          {data.invoice.map((inv) => (
            <li key={inv.id} className="flex gap-3">
              <Checkbox
                aria-label={t("pilihInvoice", { nomor: inv.vendorInvoiceNo })}
                checked={dipilih.has(inv.id)}
                onCheckedChange={(v) => {
                  const next = new Set(dipilih);
                  if (v === true) next.add(inv.id);
                  else next.delete(inv.id);
                  onUbah(next);
                }}
              />
              <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                <p className="font-medium">
                  {inv.vendorInvoiceNo}{" "}
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {bolehBukaTagihan ? (
                      <Link className="hover:underline" href={`/backoffice/vendor-bills/${inv.id}`}>
                        {inv.docNumber}
                      </Link>
                    ) : (
                      inv.docNumber
                    )}{" "}
                    · {labelTanggal(inv.billDate, locale)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("totalDicatat")}: {formatRupiah(inv.total)} · {t("dibayar")}: {formatRupiah(inv.paidAmount)}
                </p>
                <p className="text-xs text-muted-foreground">{inv.penerimaan.map((k) => nomorPenerimaan.get(k) ?? k).join(", ")}</p>
                {inv.koreksi.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {inv.koreksi.map((k) => (
                      <Badge key={k.id} variant={k.status === "MENUNGGU" ? "secondary" : "outline"}>
                        {t(`koreksi.${k.status}`, { nilai: formatRupiah(Math.abs(k.jumlahSen) / 100) })}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {dipilih.size > 0 && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <Baris label={t("ringkas.totalInvoice")} nilai={formatRupiah(ringkas.totalInvoiceDicatatSen / 100)} />
            <Baris label={t("ringkas.utangTercatat")} nilai={formatRupiah(ringkas.utangTercatatSen / 100)} />
            {ringkas.selisihMenungguSen !== 0 && <Baris label={t("ringkas.selisihMenunggu")} nilai={formatRupiah(ringkas.selisihMenungguSen / 100)} />}
            {ringkas.selisihDiterimaSen !== 0 && <Baris label={t("ringkas.selisihDiterima")} nilai={formatRupiah(ringkas.selisihDiterimaSen / 100)} />}
            {ringkas.selisihInvoiceDikoreksiSen !== 0 && <Baris label={t("ringkas.selisihDikoreksi")} nilai={formatRupiah(ringkas.selisihInvoiceDikoreksiSen / 100)} />}
            <Baris label={t("ringkas.dibayar")} nilai={formatRupiah(ringkas.dibayarSen / 100)} />
            <Baris label={t("ringkas.diisi")} nilai={formatRupiah(ringkas.diisiSen / 100)} tebal />
            {[...isi].map(([kunci, x]) =>
              x.terhalang && x.terhalang !== "DIBATASI_SISA" ? (
                <p key={kunci} className="text-xs text-amber-700 dark:text-amber-400">
                  {nomorPenerimaan.get(kunci) ?? kunci}: {t(`terhalang.${x.terhalang}`)}
                </p>
              ) : x.ikutInvoiceLebihDulu.length > 0 || x.terhalang === "DIBATASI_SISA" ? (
                <p key={kunci} className="text-xs text-muted-foreground">
                  {nomorPenerimaan.get(kunci) ?? kunci}:{" "}
                  {[
                    x.ikutInvoiceLebihDulu.length > 0 ? t("ikutMelunasi", { inv: x.ikutInvoiceLebihDulu.join(", ") }) : null,
                    x.terhalang === "DIBATASI_SISA" ? t("terhalang.DIBATASI_SISA") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null,
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${tebal ? "border-t pt-1 font-semibold" : ""}`}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{nilai}</span>
    </div>
  );
}
