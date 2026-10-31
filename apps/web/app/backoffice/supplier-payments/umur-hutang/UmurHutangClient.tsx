"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { KELOMPOK_UMUR } from "@/lib/purchasing/pembayaran-umur";
import type { LaporanUmurHutang } from "@/lib/purchasing/pembayaran-queries";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";

const rp = (sen: number) => formatRupiah(sen / 100);

export function UmurHutangClient({ laporan, tanggal, hariIni, bolehBayar }: { laporan: LaporanUmurHutang | null; tanggal: string; hariIni: string; bolehBayar: boolean }) {
  const t = useTranslations("supplierPayments.umur");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulai] = useTransition();
  const [buka, setBuka] = useState<Set<string>>(new Set());

  const ubahTanggal = (v: string) => mulai(() => router.replace(v && v !== hariIni ? `/backoffice/supplier-payments/umur-hutang?tanggal=${v}` : "/backoffice/supplier-payments/umur-hutang", { scroll: false }));
  const alih = (id: string) => setBuka((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const selisihBukuBesar = laporan && laporan.saldoBukuBesarSen != null ? laporan.saldoBukuBesarSen - laporan.total.netoSen : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { tanggal: labelTanggal(tanggal, locale) })}
        actions={
          <Link href="/backoffice/supplier-payments">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("kembali")}
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="tanggal-umur">{t("tanggalUmur")}</Label>
          <TanggalInput id="tanggal-umur" value={tanggal} max={hariIni} onChange={(e) => ubahTanggal(e.target.value)} className="w-[200px]" />
        </div>
      </div>

      {!laporan ? (
        <p className="text-sm text-destructive">{t("gagal")}</p>
      ) : (
        <>
          {laporan.apBelumDipetakan && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{t("apBelumDipetakan")}</p>
            </div>
          )}
          {selisihBukuBesar != null && selisihBukuBesar !== 0 && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{t("selisihBukuBesar", { buku: rp(laporan.saldoBukuBesarSen ?? 0), pembantu: rp(laporan.total.netoSen), selisih: rp(selisihBukuBesar) })}</p>
            </div>
          )}

          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" />
                {t("perPemasok")}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn("pb-6", pindah && "opacity-60")}>
              {laporan.baris.length === 0 ? (
                <EmptyState icon={CalendarClock} title={t("kosong")} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("kolomPemasok")}</TableHead>
                        {KELOMPOK_UMUR.map((k) => (
                          <TableHead key={k} className={cn("text-right", k === "31_60" || k === "61_90" ? "hidden xl:table-cell" : "")}>
                            {t(`kelompok.${k}`)}
                          </TableHead>
                        ))}
                        <TableHead className="hidden text-right 2xl:table-cell">{t("kolomKredit")}</TableHead>
                        <TableHead className="text-right">{t("kolomNeto")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {laporan.baris.map((b) => (
                        <Fragment key={b.supplierId}>
                          <TableRow>
                            <TableCell className="whitespace-normal">
                              <button type="button" className="flex items-center gap-1 text-left font-medium" onClick={() => alih(b.supplierId)} aria-expanded={buka.has(b.supplierId)}>
                                {buka.has(b.supplierId) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                {b.nama}
                              </button>
                              <p className="pl-5 text-xs text-muted-foreground">
                                {b.kode}
                                {b.grnBelumBerjurnal > 0 ? ` · ${t("grnBelumBerjurnal", { count: b.grnBelumBerjurnal })}` : ""}
                              </p>
                              {bolehBayar && b.totalSen > 0 && (
                                <Link href={`/backoffice/supplier-payments/baru?pemasok=${encodeURIComponent(b.supplierId)}`} className={`${TAUTAN_DOKUMEN} ml-5 text-xs`}>
                                  {t("bayar")}
                                </Link>
                              )}
                            </TableCell>
                            {KELOMPOK_UMUR.map((k) => (
                              <TableCell key={k} className={cn("text-right tabular-nums", k === "31_60" || k === "61_90" ? "hidden xl:table-cell" : "", k === "LEBIH_90" && b[k] > 0 ? "font-semibold text-destructive" : "")}>
                                {b[k] ? rp(b[k]) : "–"}
                              </TableCell>
                            ))}
                            <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{b.kreditSen ? `− ${rp(b.kreditSen)}` : "–"}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{rp(b.netoSen)}</TableCell>
                          </TableRow>
                          {buka.has(b.supplierId) &&
                            b.dokumen.map((d) => (
                              <TableRow key={`${b.supplierId}|${d.jenis}|${d.id}`} className="bg-muted/40">
                                <TableCell className="whitespace-normal ps-[calc(var(--tabel-tepi,0.5rem)+2rem)] text-sm">
                                  {d.poId ? (
                                    <Link href={`/backoffice/purchase-orders/${d.poId}`} className={TAUTAN_DOKUMEN}>
                                      {d.nomor}
                                    </Link>
                                  ) : d.woId ? (
                                    <Link href={`/backoffice/work-orders/${d.woId}`} className={TAUTAN_DOKUMEN}>
                                      {d.nomor}
                                    </Link>
                                  ) : (
                                    d.nomor
                                  )}
                                  <span className="block text-xs text-muted-foreground">
                                    {labelTanggal(d.tanggal, locale)} · {t("umurHari", { hari: d.umurHari })}
                                  </span>
                                </TableCell>
                                <TableCell colSpan={KELOMPOK_UMUR.length} className="hidden text-right text-sm tabular-nums xl:table-cell" />
                                <TableCell className="hidden 2xl:table-cell" />
                                <TableCell className="text-right text-sm tabular-nums">{formatRupiah(d.sisa)}</TableCell>
                              </TableRow>
                            ))}
                        </Fragment>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">{t("total")}</TableCell>
                        {KELOMPOK_UMUR.map((k) => (
                          <TableCell key={k} className={cn("text-right font-semibold tabular-nums", k === "31_60" || k === "61_90" ? "hidden xl:table-cell" : "")}>
                            {rp(laporan.total[k])}
                          </TableCell>
                        ))}
                        <TableCell className="hidden text-right font-semibold tabular-nums 2xl:table-cell">{laporan.total.kreditSen ? `− ${rp(laporan.total.kreditSen)}` : "–"}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{rp(laporan.total.netoSen)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
              {laporan.saldoBukuBesarSen != null && (
                <p className="mt-3 text-xs text-muted-foreground">{t("pembandingBukuBesar", { nilai: rp(laporan.saldoBukuBesarSen) })}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
