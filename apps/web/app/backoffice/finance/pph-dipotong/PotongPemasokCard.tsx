"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK } from "@/lib/finance/pajak/pemotongan";
import type { BarisPotongPemasok } from "@/lib/finance/kas/pph-dipotong-queries";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";

/**
 * PPh yang dipotong dari pembayaran pemasok (PPh 23 CMT/jasa, PPh 21 penjahit
 * perorangan, PPh 4(2) sewa) dan voucher kas keluar, satu masa. Bahan bukti
 * potong dan setoran di Coretax; setorannya dicatat di Pajak → Setoran.
 */
export function PotongPemasokCard({ baris }: { baris: BarisPotongPemasok[] }) {
  const t = useTranslations("pphDipotong.pemasok");
  const locale = useLocale();
  const perJenis = SEMUA_JENIS_POTONG_PEMASOK.map((j) => ({ jenis: j, sen: baris.filter((b) => b.jenis === j).reduce((s, b) => s + Math.round(b.pph * 100), 0) })).filter((x) => x.sen > 0);
  const total = baris.reduce((s, b) => s + Math.round(b.pph * 100), 0) / 100;
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        {perJenis.length > 0 && (
          <p className="text-sm text-muted-foreground">{perJenis.map((p) => `${INFO_POTONG_PEMASOK[p.jenis].label}: ${formatRupiah(p.sen / 100)}`).join(" · ")}</p>
        )}
      </CardHeader>
      <CardContent className="pb-6">
        {baris.length === 0 ? (
          <EmptyState icon={Receipt} title={t("kosong")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomDokumen")}</TableHead>
                  <TableHead>{t("kolomPihak")}</TableHead>
                  <TableHead>{t("kolomJenis")}</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">{t("kolomDasar")}</TableHead>
                  <TableHead className="text-right">{t("kolomPph")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b) => (
                  <TableRow key={`${b.sumber}|${b.id}`}>
                    <TableCell className="align-top">
                      <Link href={b.sumber === "PEMBAYARAN_PEMASOK" ? `/backoffice/supplier-payments/${b.id}` : `/backoffice/finance/kas/${b.id}`} className={TAUTAN_DOKUMEN}>
                        {b.nomor}
                      </Link>
                      <p className="text-xs text-muted-foreground">{labelTanggal(b.tanggal, locale)}</p>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <p>{b.pihak}</p>
                      {b.identitas && <p className="text-xs text-muted-foreground">{b.identitas}</p>}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <p>{INFO_POTONG_PEMASOK[b.jenis].label}</p>
                      {b.dibebaskanSkb && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          {t("dibebaskanSkb", { nomor: b.dibebaskanSkb.nomor, tanggal: labelTanggal(b.dibebaskanSkb.berlakuSampai, locale) })}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden align-top text-right tabular-nums xl:table-cell">{b.dasar != null ? formatRupiah(b.dasar) : "–"}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{formatRupiah(b.pph)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-semibold">
                    {t("total")}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell" />
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
