"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { DataPelangganToko } from "@/lib/spg/pelanggan-kantor";
import { PERIODE_BAWAAN_HARI, STATUS_PELANGGAN, type SaringMember, type StatusPelanggan } from "@/lib/spg/pelanggan-lacak";
import { cn } from "@/lib/utils";
import { denganParam } from "../piutang/_daftar/halaman";
import { HalamanDaftar } from "../piutang/_daftar/HalamanDaftar";
import { KotakCari } from "../piutang/_daftar/KotakCari";
import { NADA_STATUS_PELANGGAN, PilihPeriode, UbinLacak } from "./UbinLacak";

const JALUR = "/backoffice/spg-pelanggan";

/**
 * Pelanggan satu toko: ubin ringkasan periode, tombol saring status dan
 * keanggotaan (angkanya mengikuti kotak cari), lalu daftar satu halaman.
 * Saringan hidup di alamat dan ditulis dengan `replace`.
 */
export function DaftarPelangganToko({
  data,
  periodeHari,
  cari,
  saring,
}: {
  data: DataPelangganToko;
  periodeHari: number;
  cari: string;
  saring: { status: StatusPelanggan | null; member: SaringMember | null };
}) {
  const t = useTranslations("spgPelanggan.kantor");
  const td = dinamis(t);
  const locale = useLocale();
  const tgl = (iso: string | null) => (iso ? formatDisplayDate(iso, locale) : "—");
  const tetap = { toko: data.toko.id, periode: periodeHari === PERIODE_BAWAAN_HARI ? undefined : String(periodeHari), cari: cari || undefined };
  const href = (ganti: { status?: StatusPelanggan | null; member?: SaringMember | null }) =>
    denganParam(JALUR, { ...tetap, status: saring.status ?? undefined, member: saring.member ?? undefined }, { ...ganti, halaman: null });
  const disaring = !!saring.status || !!saring.member || cari !== "";
  const h = data.halaman;

  const tombol = (kunci: string, aktif: boolean, tujuan: string, isi: ReactNode, n: number) => (
    <Link
      key={kunci}
      href={tujuan}
      replace
      scroll={false}
      aria-current={aktif ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        aktif ? "border-primary ring-1 ring-primary/40" : "border-border hover:bg-muted/60",
      )}
    >
      {isi}
      <span className="font-semibold tabular-nums">{n}</span>
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={denganParam(JALUR, {}, { periode: tetap.periode })} replace>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("semuaToko")}
          </Link>
        </Button>
        <PilihPeriode periodeHari={periodeHari} />
      </div>

      <UbinLacak r={data.ringkas} hariTidur={data.hariTidur} />

      <div className="space-y-3">
        <KotakCari nilai={cari} placeholder={t("cariPelanggan")} label={t("cariPelanggan")} />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("saring.status")}>
          {tombol("semua", !saring.status, href({ status: null }), <span>{t("saring.semua")}</span>, data.hitung.semua)}
          {STATUS_PELANGGAN.filter((s) => data.hitung.status[s] > 0 || saring.status === s).map((s) =>
            tombol(
              s,
              saring.status === s,
              href({ status: saring.status === s ? null : s }),
              <StatusPill tone={NADA_STATUS_PELANGGAN[s]}>{td(`status.${s}`)}</StatusPill>,
              data.hitung.status[s],
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("saring.member")}>
          {(["ya", "tidak"] as const).map((k) =>
            tombol(k, saring.member === k, href({ member: saring.member === k ? null : k }), <span>{t(k === "ya" ? "saring.member" : "saring.bukanMember")}</span>, data.hitung.member[k]),
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("pelangganToko", { toko: data.toko.name })}
          </CardTitle>
        </CardHeader>
        <CardContent className={h.baris.length === 0 ? undefined : "px-0"}>
          {h.baris.length === 0 ? (
            disaring ? (
              <EmptyState
                icon={Users}
                title={t("kosongSaringJudul")}
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href={denganParam(JALUR, {}, { toko: data.toko.id, periode: tetap.periode })} replace>
                      {t("hapusSaring")}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={Users} title={t("kosongTokoJudul")} description={t("kosongTokoIsi")} />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="[&_th]:whitespace-normal">
                  <TableRow>
                    <TableHead>{t("kolom.nama")}</TableHead>
                    <TableHead>{t("kolom.hp")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                    <TableHead className="text-right">{t("kolom.totalBelanja")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.rata")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.pertama")}</TableHead>
                    <TableHead>{t("kolom.belanjaTerakhir")}</TableHead>
                    <TableHead>{t("kolom.favorit")}</TableHead>
                    <TableHead className="text-right">{t("kolom.titipTerbuka")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.baris.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        <span className="font-medium">{p.nama}</span>
                        {p.member ? (
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <Badge variant={p.member.aktif ? "secondary" : "outline"}>
                              {p.member.aktif ? t("memberTingkat", { tingkat: p.member.tingkat }) : t("memberNonaktif")}
                            </Badge>
                          </span>
                        ) : null}
                        <span className="block text-xs text-muted-foreground">{t("dicatatPada", { tanggal: tgl(p.dicatat) })}</span>
                      </TableCell>
                      <TableCell className="tabular-nums">{p.hpSamar}</TableCell>
                      <TableCell>
                        <StatusPill tone={NADA_STATUS_PELANGGAN[p.status]}>{td(`status.${p.status}`)}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.nota}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(p.belanja)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{p.rataNota === null ? "—" : formatIDR(p.rataNota)}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{tgl(p.pertama)}</TableCell>
                      <TableCell>
                        {tgl(p.terakhir)}
                        {p.hariSejak !== null ? (
                          <span className="block text-xs text-muted-foreground">{p.hariSejak === 0 ? t("hariIni") : t("hariLalu", { n: p.hariSejak })}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[8rem] whitespace-normal">
                        {p.favorit ? (
                          <>
                            {p.favorit.nama}
                            <span className="block text-xs text-muted-foreground">{t("favoritPotong", { n: p.favorit.potong })}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.titipTerbuka}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {h.baris.length > 0 ? <HalamanDaftar halaman={h.halaman} totalHalaman={h.totalHalaman} total={h.total} ukuran={h.ukuran} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
