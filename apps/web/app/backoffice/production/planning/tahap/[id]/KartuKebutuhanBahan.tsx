"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Layers, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RuangKerjaTahap } from "@/lib/production/jadwal-queries";
import { tautanPoDariTahap } from "@/lib/purchase-orders/tahap";
import { angkaTampil, keadaanKebutuhan, type KeadaanKebutuhan } from "./ruang-kerja";

const NADA: Record<KeadaanKebutuhan, StatusTone> = {
  KURANG: "attention",
  PAS: "settled",
  LEBIH: "waiting",
};

/**
 * Bahan dari aturan pemakaian barang jadi tahap × qty, dibandingkan dengan PO
 * tahap ini. Bahan yang masih kurang punya tombol "Buat PO" (formulir PO baru
 * terisi kekurangannya); "Buat PO semua yang kurang" mengisi semuanya sekaligus.
 * Tombolnya butuh izin melihat PO (untuk tahu kekurangannya) dan membuat PO.
 */
export function KartuKebutuhanBahan({
  data,
  lihatPo,
  buatPo = false,
}: {
  data: Pick<RuangKerjaTahap, "tahap" | "kebutuhan">;
  lihatPo: boolean;
  buatPo?: boolean;
}) {
  const t = useTranslations("jadwalProduksi.ruang");
  const locale = useLocale();
  const { tahap, kebutuhan } = data;
  const angka = (n: number) => angkaTampil(n, locale);
  const bolehBuatPo = lihatPo && buatPo;
  const adaKurang = kebutuhan.some((k) => keadaanKebutuhan(k.butuh, k.diPo).keadaan === "KURANG");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("kebutuhanJudul")}
        </CardTitle>
        {bolehBuatPo && adaKurang ? (
          <CardAction>
            <Button asChild size="sm">
              <Link href={tautanPoDariTahap(tahap.id)}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                {t("buatPoSemua")}
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {!tahap.barang ? (
          <EmptyState icon={Layers} title={t("kebutuhanTanpaBarang")} />
        ) : kebutuhan.length === 0 ? (
          <EmptyState icon={Layers} title={t("kebutuhanKosong")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">{t("kolBahan")}</TableHead>
                  <TableHead className="text-right">{t("kolPerPcs")}</TableHead>
                  <TableHead className="text-right">{t("kolButuh")}</TableHead>
                  {lihatPo ? (
                    <>
                      <TableHead className="text-right">{t("kolDiPo")}</TableHead>
                      <TableHead className="text-right">{t("kolDiterima")}</TableHead>
                      <TableHead>{t("kolKeadaan")}</TableHead>
                      {bolehBuatPo ? (
                        <TableHead className="w-24">
                          <span className="sr-only">{t("kolAksi")}</span>
                        </TableHead>
                      ) : null}
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {kebutuhan.map((k) => {
                  const { keadaan, selisih } = keadaanKebutuhan(k.butuh, k.diPo);
                  return (
                    <TableRow key={k.itemId}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{k.nama}</p>
                        <p className="text-xs text-muted-foreground">{k.sku}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="whitespace-nowrap">
                          {angka(k.perPcs)} {k.satuan}
                        </span>
                        {k.wastePercent > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {t("sisaPotong", { n: angka(k.wastePercent) })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {angka(k.butuh)} {k.satuan}
                      </TableCell>
                      {lihatPo ? (
                        <>
                          <TableCell className="text-right whitespace-nowrap">{angka(k.diPo)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{angka(k.diterima)}</TableCell>
                          <TableCell>
                            <StatusPill tone={NADA[keadaan]}>
                              {keadaan === "PAS"
                                ? t("keadaanPas")
                                : keadaan === "KURANG"
                                  ? t("keadaanKurang", { n: angka(-selisih), satuan: k.satuan })
                                  : t("keadaanLebih", { n: angka(selisih), satuan: k.satuan })}
                            </StatusPill>
                          </TableCell>
                          {bolehBuatPo ? (
                            <TableCell className="text-right">
                              {keadaan === "KURANG" ? (
                                <Button asChild variant="outline" size="sm">
                                  <Link href={tautanPoDariTahap(tahap.id, [k.itemId])} aria-label={t("buatPoBahanLabel", { bahan: k.nama })}>
                                    {t("buatPoBahan")}
                                  </Link>
                                </Button>
                              ) : null}
                            </TableCell>
                          ) : null}
                        </>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
