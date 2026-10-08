"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { KATEGORI_ASET } from "@/lib/finance/aset/kelompok";
import { bacaKunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import type { BarisAset, RingkasanAset, SaringanStatusAset } from "@/lib/finance/aset/queries";
import { DialogPostingPenyusutan } from "./DialogPostingPenyusutan";
import { nadaStatusAset } from "./tampilan";

type Props = {
  baris: BarisAset[];
  total: number;
  ringkasan: RingkasanAset;
  halaman: number;
  ukuran: number;
  saringan: { status: SaringanStatusAset; kategori: string; cari: string };
  bulanIni: string;
  penyusutanTertunda: number;
  bolehMengelola: boolean;
  gagal: boolean;
};

const SEMUA = "__semua__";
const STATUS_PILIHAN: SaringanStatusAset[] = ["AKTIF", "DILEPAS", "BATAL", "SEMUA"];

export function AsetTetapClient({ baris, total, ringkasan, halaman, ukuran, saringan, bulanIni, penyusutanTertunda, bolehMengelola, gagal }: Props) {
  const t = useTranslations("asetTetap");
  const locale = useLocale();
  const router = useRouter();
  const [, mulai] = useTransition();
  const [cari, setCari] = useState(saringan.cari);

  const pergi = (ubah: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const isi = { status: saringan.status, kategori: saringan.kategori, cari: saringan.cari, ...ubah };
    if (isi.status && isi.status !== "AKTIF") q.set("status", isi.status);
    if (isi.kategori) q.set("kategori", isi.kategori);
    if (isi.cari) q.set("cari", isi.cari);
    if (ubah.halaman) q.set("halaman", ubah.halaman);
    mulai(() => router.replace(`/backoffice/finance/aset-tetap${q.size ? `?${q.toString()}` : ""}`, { scroll: false }));
  };

  useEffect(() => {
    const h = setTimeout(() => {
      if (cari.trim() !== saringan.cari) pergi({ cari: cari.trim() || null });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cari]);

  const bersaring = saringan.status !== "AKTIF" || !!saringan.kategori || !!saringan.cari;
  const bulanLabel = (k: string | null) => {
    const tb = k ? bacaKunciBulan(k) : null;
    return tb ? labelBulan(tb, locale) : "—";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("metaJumlah", { n: ringkasan.jumlah })}
        actions={
          bolehMengelola ? (
            <>
              <DialogPostingPenyusutan bulanIni={bulanIni} jumlahTertunda={penyusutanTertunda} variant="outline" />
              <Button asChild>
                <Link href="/backoffice/finance/aset-tetap/baru">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("catat")}
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kartu label={t("kartu.biaya")} nilai={formatRupiah(ringkasan.biaya)} />
        <Kartu label={t("kartu.akumulasi")} nilai={formatRupiah(ringkasan.akumulasi)} />
        <Kartu label={t("kartu.nilaiBuku")} nilai={formatRupiah(ringkasan.nilaiBuku)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className="relative w-full sm:max-w-sm sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("saring.cari")} aria-label={t("saring.cari")} className="pl-9" />
        </div>
        <Select value={saringan.status} onValueChange={(v) => pergi({ status: v, halaman: null })}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label={t("saring.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_PILIHAN.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saringan.kategori || SEMUA} onValueChange={(v) => pergi({ kategori: v === SEMUA ? null : v, halaman: null })}>
          <SelectTrigger className="w-full sm:w-[240px]" aria-label={t("saring.kelompok")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("saring.semuaKelompok")}</SelectItem>
            {KATEGORI_ASET.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`kategori.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t("daftar.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gagal ? (
            <EmptyState icon={Building2} title={t("gagalMuat")} />
          ) : baris.length === 0 ? (
            bersaring ? (
              <EmptyState icon={Building2} title={t("kosongSaring.judul")} description={t("kosongSaring.isi")} />
            ) : (
              <EmptyState
                icon={Building2}
                title={t("kosong.judul")}
                description={t("kosong.isi")}
                action={
                  bolehMengelola ? (
                    <Button asChild>
                      <Link href="/backoffice/finance/aset-tetap/baru">{t("catat")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.kode")}</TableHead>
                      <TableHead className="min-w-[180px]">{t("kolom.nama")}</TableHead>
                      <TableHead className="hidden 2xl:table-cell">{t("kolom.kelompok")}</TableHead>
                      <TableHead>{t("kolom.perolehan")}</TableHead>
                      <TableHead className="text-right">{t("kolom.biaya")}</TableHead>
                      <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.akumulasi")}</TableHead>
                      <TableHead className="text-right">{t("kolom.nilaiBuku")}</TableHead>
                      <TableHead>{t("kolom.status")}</TableHead>
                      <TableHead className="hidden 2xl:table-cell">{t("kolom.terakhir")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="baris-berurutan">
                    {baris.map((a) => (
                      <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => mulai(() => router.push(`/backoffice/finance/aset-tetap/${a.id}`))}>
                        <TableCell className="font-mono text-sm">
                          <Link href={`/backoffice/finance/aset-tetap/${a.id}`} className="underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                            {a.kode}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <p className="font-medium">{a.nama}</p>
                          <p className="text-xs text-muted-foreground 2xl:hidden">{t(`kategori.${a.kategori}` as never)}</p>
                          {a.lokasi ? <p className="text-xs text-muted-foreground">{a.lokasi}</p> : null}
                        </TableCell>
                        <TableCell className="hidden whitespace-normal 2xl:table-cell">{t(`kategori.${a.kategori}` as never)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDisplayDate(a.tanggalPerolehan, locale)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(a.biaya)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(a.akumulasi)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(a.nilaiBuku)}</TableCell>
                        <TableCell>
                          <StatusPill tone={nadaStatusAset(a.status)}>{t(`statusAset.${a.status}` as never)}</StatusPill>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap 2xl:table-cell">{bulanLabel(a.penyusutanTerakhir)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {total > ukuran ? (
                <Pagination
                  page={halaman}
                  totalPages={Math.max(1, Math.ceil(total / ukuran))}
                  onPageChange={(p) => pergi({ halaman: String(p) })}
                  totalCount={total}
                  pageSize={ukuran}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kartu({ label, nilai }: { label: string; nilai: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{nilai}</p>
    </Card>
  );
}
