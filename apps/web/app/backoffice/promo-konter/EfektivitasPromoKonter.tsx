"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import type { DaftarEfektivitas } from "@/lib/spg/efektivitas-promo-queries";
import { cn } from "@/lib/utils";
import { akhirInklusif, angkaId, KELAS_ARAH, perubahanPersen, rupiahPecahan } from "./efektivitas-tampil";
import { NADA_STATUS_PROMO } from "./tampilan";

/**
 * Tab "Efektivitas": promo yang berjalan di rentang, dengan pemakaian dan
 * perbandingan penjualan barang sasarannya. Setiap baris membuka halaman hasil
 * dengan rentang yang SAMA, jadi angkanya cocok dengan baris ini.
 */
export function EfektivitasPromoKonter({ data, dari, sampai }: { data: DaftarEfektivitas; dari: string; sampai: string }) {
  const t = useTranslations("efektivitasPromo");
  const ts = dinamis(useTranslations("promoKonter"));
  const locale = useLocale();
  const tgl = (d: Date | string) => formatDisplayDate(d, locale);
  const notaLama = data.baris.reduce((s, b) => s + b.notaLama, 0);
  const q = new URLSearchParams({ dari, sampai }).toString();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          {t("daftarJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className={data.baris.length === 0 ? undefined : "space-y-3 px-0"}>
        {data.baris.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.promo")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead>{t("kolom.periode")}</TableHead>
                    <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                    <TableHead className="text-right">{t("kolom.pcs")}</TableHead>
                    <TableHead className="text-right">{t("kolom.potongan")}</TableHead>
                    <TableHead className="text-right">{t("kolom.perubahan")}</TableHead>
                    <TableHead className="text-right">{t("kolom.biaya")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => {
                    const ubah = perubahanPersen(b.penjualan.rupiah.persen);
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="min-w-[13rem] whitespace-normal">
                          <Link
                            href={`/backoffice/promo-konter/${b.id}/hasil?${q}`}
                            className="font-medium text-tautan underline-offset-2 hover:underline"
                          >
                            {b.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{b.ringkasan}</span>
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={NADA_STATUS_PROMO[b.status]}>{ts(`status.${b.status}`)}</StatusPill>
                        </TableCell>
                        <TableCell className="min-w-[11rem] whitespace-normal text-sm">
                          {tgl(b.mulai)} – {b.masihBerjalan ? t("sampaiSekarang") : tgl(akhirInklusif(b.akhir))}
                          <span className="block text-xs text-muted-foreground">
                            {t("hari", { n: angkaId(b.hari, 1) })}
                            {b.dipotongRentang ? ` · ${t("dipotong")}` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{angkaId(b.pemakaian.nota)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.pemakaian.pcs === null ? <span className="text-xs text-muted-foreground">{t("promoBelanja")}</span> : angkaId(b.pemakaian.pcs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(b.pemakaian.potongan)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {ubah ? (
                            <span className={cn("font-medium", KELAS_ARAH[ubah.arah])}>{ubah.teks}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("belumAdaPembanding")}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">
                            {formatRupiah(b.penjualan.rupiah.promo)} / {formatRupiah(b.penjualan.rupiah.pembanding)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.biaya === null ? (
                            <span className="text-xs text-muted-foreground">{t(b.biayaAlasan === "TANPA_PEMBANDING" ? "belumAdaPembanding" : "tidakNaik")}</span>
                          ) : (
                            rupiahPecahan(b.biaya)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-1 px-6 text-xs text-muted-foreground">
              <p>{t("pengakuan")}</p>
              {notaLama > 0 ? <p>{t("notaLamaDaftar", { n: angkaId(notaLama) })}</p> : null}
              {data.terpotong ? <p>{t("terpotong")}</p> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
