"use client";

import { useTranslations } from "next-intl";
import { Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import type { EntriPiutangToko } from "@/lib/finance/saldo-awal/jenis";
import type { KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { AksiSaldoAwal, type KonteksSaldoAwal } from "./AksiSaldoAwal";

const sen = (n: number) => Math.round(n * 100);

/**
 * Piutang toko per tanggal mulai — SELALU dihitung dari modul piutang, tidak
 * pernah diketik: angka yang berbeda dari modul membuat rekonsiliasi piutang
 * tidak akan pernah cocok. Koreksi dilakukan di modul piutang, lalu posting ulang.
 */
export function EditorPiutangToko({
  hitungan,
  keadaan,
  konteks,
}: {
  hitungan: EntriPiutangToko[];
  keadaan: KeadaanJenisSaldoAwal;
  konteks: KonteksSaldoAwal;
}) {
  const t = useTranslations("saldoAwal");
  const total = hitungan.reduce((s, b) => s + sen(b.jumlah), 0) / 100;
  const diposting = keadaan.posting ? sen(keadaan.posting.ekuitas) : null;
  const berubah = diposting !== null && diposting !== sen(total);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" aria-hidden />
          {t("jenis.AR_STORE")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hitungan.length === 0 ? (
          <EmptyState icon={Store} title={t("piutangToko.kosong")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.toko")}</TableHead>
                  <TableHead className="text-right">{t("kolom.faktur")}</TableHead>
                  <TableHead className="text-right">{t("kolom.sisa")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hitungan.map((b) => (
                  <TableRow key={b.storeId}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{b.nama}</span>
                      {b.kode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{b.kode}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.faktur}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(b.jumlah)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t("total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{hitungan.reduce((s, b) => s + b.faktur, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        {berubah ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t("piutangToko.berubah", { nilai: formatRupiah(keadaan.posting!.ekuitas) })}</p>
        ) : null}
        <AksiSaldoAwal jenis="AR_STORE" konteks={konteks} keadaan={keadaan} baris={[]} catatan="" ekuitas={total} alasanBelum={null} tanpaDraf />
      </CardContent>
    </Card>
  );
}
