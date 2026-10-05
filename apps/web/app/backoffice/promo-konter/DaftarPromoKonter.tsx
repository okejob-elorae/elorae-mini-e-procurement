"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { STATUS_PROMO_KONTER, type StatusPromoKonter } from "@/lib/spg/promo-konter-kantor";
import type { BarisPromoKantor, DaftarPromoKantor } from "@/lib/spg/promo-konter-kantor-queries";
import { cn } from "@/lib/utils";
import { formatPersen, NADA_STATUS_PROMO } from "./tampilan";
import { TombolPromoKonter } from "./TombolPromoKonter";

/** Paling banyak sekian nama ditulis di sel; sisanya "+N lainnya". */
const NAMA_TAMPIL = 3;

export function DaftarPromoKonter({
  data,
  status,
  bolehUbah,
  onStatus,
}: {
  data: DaftarPromoKantor;
  status: StatusPromoKonter | null;
  bolehUbah: boolean;
  onStatus: (s: StatusPromoKonter | null) => void;
}) {
  const t = useTranslations("promoKonter");
  const td = dinamis(t);

  const daftarNama = (nama: string[]) =>
    nama.length <= NAMA_TAMPIL ? nama.join(", ") : `${nama.slice(0, NAMA_TAMPIL).join(", ")} ${t("lainnya", { n: nama.length - NAMA_TAMPIL })}`;

  const sasaran = (b: BarisPromoKantor) => {
    if (b.semuaBarang) return t("semuaBarang");
    const bagian: string[] = [];
    if (b.barang.length) bagian.push(t("sasaranBarang", { n: b.barang.length, nama: daftarNama(b.barang) }));
    if (b.kategori.length) bagian.push(t("sasaranKategori", { n: b.kategori.length, nama: daftarNama(b.kategori) }));
    return bagian.join(" · ");
  };

  const masa = (b: BarisPromoKantor) => {
    if (!b.mulai && !b.akhir) return t("tanpaBatas");
    if (!b.akhir) return t("sejak", { tanggal: b.mulai ?? "" });
    if (!b.mulai) return t("sampaiDengan", { tanggal: b.akhir });
    return b.mulai === b.akhir ? b.mulai : `${b.mulai} – ${b.akhir}`;
  };

  const tanggungan = (persen: number) =>
    persen <= 0
      ? t("tanggungElorae")
      : persen >= 100
        ? t("tanggungToko")
        : t("tanggungBagi", { toko: formatPersen(persen), elorae: formatPersen(Math.round((100 - persen) * 100) / 100) });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_PROMO_KONTER.map((s) => (
          <Button
            key={s}
            variant="outline"
            aria-pressed={status === s}
            onClick={() => onStatus(status === s ? null : s)}
            className={cn("h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left", status === s && "border-primary ring-1 ring-primary")}
          >
            <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
            <span className="text-lg font-semibold tabular-nums">{data.perStatus[s]}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            {t("daftarJudul")}
            <span className="ml-1 text-sm font-normal text-muted-foreground">({data.baris.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={status ? t("kosongSaringJudul") : t("kosongJudul")}
              description={status ? t("kosongSaringIsi") : t("kosongIsi")}
              action={
                bolehUbah && !status ? (
                  <Button asChild>
                    <Link href="/backoffice/promo-konter/baru">{t("buat")}</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.promo")}</TableHead>
                    <TableHead>{t("kolom.sasaran")}</TableHead>
                    <TableHead>{t("kolom.toko")}</TableHead>
                    <TableHead>{t("kolom.masa")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.prioritas")}</TableHead>
                    <TableHead className="text-right">{t("kolom.dipakai")}</TableHead>
                    <TableHead className="w-0 text-right">{t("kolom.aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="min-w-[13rem] whitespace-normal">
                        <Link href={`/backoffice/promo-konter/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                          {b.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.ringkasan}</span>
                        <span className="block text-xs text-muted-foreground">{tanggungan(b.bagianToko)}</span>
                      </TableCell>
                      <TableCell className="min-w-[12rem] max-w-xs whitespace-normal text-sm">{sasaran(b)}</TableCell>
                      <TableCell className="min-w-[10rem] max-w-xs whitespace-normal text-sm">
                        {b.semuaToko ? t("semuaToko") : t("tokoTerpilih", { n: b.toko.length, nama: daftarNama(b.toko) })}
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal text-sm">{masa(b)}</TableCell>
                      <TableCell>
                        <StatusPill tone={NADA_STATUS_PROMO[b.status]}>{td(`status.${b.status}`)}</StatusPill>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{b.priority}</TableCell>
                      <TableCell className="text-right">
                        <span className="block tabular-nums">{t("nNota", { n: b.nota })}</span>
                        {b.potongan > 0 ? <span className="block text-xs text-muted-foreground tabular-nums">{formatRupiah(b.potongan)}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <TombolPromoKonter id={b.id} nama={b.name} isActive={b.isActive} nota={b.nota} bolehUbah={bolehUbah} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
