"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, PiggyBank, Search, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import type { JenisVoucher } from "@/lib/finance/kas/aturan";
import type { HalamanVoucher } from "@/lib/finance/kas/voucher-queries";
import type { RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";

export type SaringanKas = { jenis: JenisVoucher | ""; rekening: string; status: "" | "POSTED" | "CANCELLED"; dari: string; sampai: string; cari: string; halaman: number };

const ALAMAT = "/backoffice/finance/kas";
const SEMUA = "__semua__";

export function KasClient({ saringan, data, rekening, bolehKelola }: { saringan: SaringanKas; data: HalamanVoucher | null; rekening: RekeningKasBank[]; bolehKelola: boolean }) {
  const t = useTranslations("financeKas");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulai] = useTransition();
  const [cari, setCari] = useState(saringan.cari);

  const pergi = (ubah: Partial<SaringanKas>) => {
    const s = { ...saringan, halaman: 1, ...ubah };
    const q = new URLSearchParams();
    for (const k of ["jenis", "rekening", "status", "dari", "sampai", "cari"] as const) if (s[k]) q.set(k, s[k]);
    if (s.halaman > 1) q.set("halaman", String(s.halaman));
    const qs = q.toString();
    mulai(() => router.replace(qs ? `${ALAMAT}?${qs}` : ALAMAT, { scroll: false }));
  };

  useEffect(() => {
    const k = cari.trim();
    if (k === saringan.cari) return;
    const id = window.setTimeout(() => pergi({ cari: k }), 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pergi membaca saringan terbaru
  }, [cari]);

  const ikon = (j: JenisVoucher) => (j === "OUT" ? ArrowUpRight : j === "IN" ? ArrowDownLeft : ArrowLeftRight);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        actions={
          <>
            <Link href={`${ALAMAT}/kas-kecil`}>
              <Button variant="outline">
                <PiggyBank className="mr-2 h-4 w-4" />
                {t("kasKecil.judul")}
              </Button>
            </Link>
            <Link href={`${ALAMAT}/kategori`}>
              <Button variant="outline">
                <Tags className="mr-2 h-4 w-4" />
                {t("kategori.judul")}
              </Button>
            </Link>
            <Link href="/backoffice/finance/rekonsiliasi-bank">
              <Button variant="outline">
                <Landmark className="mr-2 h-4 w-4" />
                {t("rekonsiliasiBank")}
              </Button>
            </Link>
          </>
        }
      />

      {bolehKelola && (
        <div className="flex flex-wrap gap-2">
          {(["OUT", "IN", "TRANSFER"] as const).map((j) => {
            const Ikon = ikon(j);
            return (
              <Link key={j} href={`${ALAMAT}/baru?jenis=${j}`}>
                <Button variant={j === "OUT" ? "default" : "outline"}>
                  <Ikon className="mr-2 h-4 w-4" />
                  {t(`baru.${j}`)}
                </Button>
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("cari")} aria-label={t("cari")} className="pl-9" />
        </div>
        <Select value={saringan.jenis || SEMUA} onValueChange={(v) => pergi({ jenis: v === SEMUA ? "" : (v as JenisVoucher) })}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label={t("saringJenis")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaJenis")}</SelectItem>
            {(["OUT", "IN", "TRANSFER"] as const).map((j) => (
              <SelectItem key={j} value={j}>
                {t(`jenis.${j}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saringan.rekening || SEMUA} onValueChange={(v) => pergi({ rekening: v === SEMUA ? "" : v })}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label={t("saringRekening")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaRekening")}</SelectItem>
            {rekening.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nama} ({r.kode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="w-full sm:w-[240px]">
          <RentangTanggalInput dari={saringan.dari} sampai={saringan.sampai} onChange={(r) => pergi({ dari: r.dari, sampai: r.sampai })} placeholder={t("rentang")} aria-label={t("rentang")} />
        </div>
        <Select value={saringan.status || SEMUA} onValueChange={(v) => pergi({ status: v === SEMUA ? "" : (v as "POSTED" | "CANCELLED") })}>
          <SelectTrigger className="w-full sm:w-[150px]" aria-label={t("saringStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaStatus")}</SelectItem>
            <SelectItem value="POSTED">{t("status.POSTED")}</SelectItem>
            <SelectItem value="CANCELLED">{t("status.CANCELLED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!data ? (
        <p className="text-sm text-destructive">{t("gagalMemuat")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ["OUT", data.ringkasan.keluar],
                ["IN", data.ringkasan.masuk],
                ["TRANSFER", data.ringkasan.transfer],
              ] as const
            ).map(([j, n]) => {
              const Ikon = ikon(j);
              return (
                <Card key={j} className="gap-2 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Ikon className="h-4 w-4" />
                      {t(`ringkasan.${j}`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4">
                    <p className="text-2xl font-bold tabular-nums">{formatRupiah(n)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>{t("daftar")}</CardTitle>
            </CardHeader>
            <CardContent className={cn("pb-6", pindah && "opacity-60")}>
              {data.baris.length === 0 ? (
                <EmptyState icon={ArrowLeftRight} title={t("kosong")} description={bolehKelola ? t("kosongIsi") : undefined} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("kolom.nomor")}</TableHead>
                          <TableHead>{t("kolom.rekening")}</TableHead>
                          <TableHead>{t("kolom.uraian")}</TableHead>
                          <TableHead className="text-right">{t("kolom.jumlah")}</TableHead>
                          <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.potong")}</TableHead>
                          <TableHead>{t("kolom.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.baris.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell className="align-top">
                              <Link href={`${ALAMAT}/${v.id}`} className={TAUTAN_DOKUMEN}>
                                {v.nomor}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {t(`jenis.${v.jenis}`)} · {labelTanggal(v.tanggal, locale)}
                              </p>
                            </TableCell>
                            <TableCell className="align-top whitespace-normal text-sm">
                              {v.rekening}
                              {v.rekeningTujuan && <span className="block text-xs text-muted-foreground">→ {v.rekeningTujuan}</span>}
                            </TableCell>
                            <TableCell className="align-top whitespace-normal text-sm">
                              {v.pihak && <p className="font-medium">{v.pihak}</p>}
                              {v.keterangan && <p className="line-clamp-2 text-muted-foreground">{v.keterangan}</p>}
                              {!v.pihak && !v.keterangan && "–"}
                            </TableCell>
                            <TableCell className={cn("align-top text-right tabular-nums", v.jenis === "IN" ? "text-emerald-700 dark:text-emerald-400" : "")}>
                              {v.jenis === "OUT" ? "−" : v.jenis === "IN" ? "+" : ""}
                              {formatRupiah(v.total)}
                            </TableCell>
                            <TableCell className="hidden align-top text-right tabular-nums 2xl:table-cell">{v.potong > 0 ? formatRupiah(v.potong) : "–"}</TableCell>
                            <TableCell className="align-top">
                              {v.status === "CANCELLED" ? <StatusPill tone="inactive">{t("status.CANCELLED")}</StatusPill> : <StatusPill tone="settled">{t("status.POSTED")}</StatusPill>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination page={data.halaman} totalPages={Math.max(1, Math.ceil(data.total / data.ukuran))} onPageChange={(h) => pergi({ halaman: h })} totalCount={data.total} pageSize={data.ukuran} />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
