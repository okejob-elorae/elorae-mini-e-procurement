"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { STATUS_MUTASI, type StatusMutasi } from "@/lib/spg/mutasi-aturan";
import type { DaftarMutasiKantor } from "@/lib/spg/mutasi-queries";
import { cn } from "@/lib/utils";
import { nadaStatusMutasi } from "@/app/pwa/spg/mutasi/tampilan";

const SEMUA = "__semua__";

export function DaftarMutasiClient({
  status,
  selisih,
  cari,
  data,
}: {
  status: StatusMutasi | null;
  selisih: boolean;
  cari: string | null;
  data: DaftarMutasiKantor;
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const router = useRouter();
  const [teks, setTeks] = useState(cari ?? "");

  // Semua kunci saringan ditulis dalam SATU navigasi — dua dorongan berurutan saling menimpa.
  const pindah = (ubah: { status?: string | null; selisih?: boolean; q?: string | null }) => {
    const q = new URLSearchParams();
    const s = ubah.status !== undefined ? ubah.status : status;
    const sel = ubah.selisih !== undefined ? ubah.selisih : selisih;
    const c = ubah.q !== undefined ? ubah.q : cari;
    if (s) q.set("status", s);
    if (sel) q.set("selisih", "1");
    if (c) q.set("q", c);
    const qs = q.toString();
    router.replace(qs ? `/backoffice/spg-transfers?${qs}` : "/backoffice/spg-transfers");
  };

  const disaring = status !== null || selisih || cari !== null;
  const menunggu = data.perStatus.DIAJUKAN;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kantor.judul")}
        meta={t("kantor.ringkas", { total: data.total, menunggu, selisih: data.selisihTerbuka })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <form
          className="flex w-full gap-2 sm:w-80"
          onSubmit={(e) => {
            e.preventDefault();
            pindah({ q: teks.trim() || null });
          }}
        >
          <Input type="search" value={teks} onChange={(e) => setTeks(e.target.value)} placeholder={t("kantor.cari")} aria-label={t("kantor.cari")} />
          <Button type="submit" variant="outline" size="icon" aria-label={t("kantor.cari")}>
            <Search className="h-4 w-4" />
          </Button>
        </form>
        <Select value={status ?? SEMUA} onValueChange={(v) => pindah({ status: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("kantor.saringStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kantor.semuaStatus")}</SelectItem>
            {STATUS_MUTASI.map((s) => (
              <SelectItem key={s} value={s}>
                {td(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={selisih ? "default" : "outline"} aria-pressed={selisih} onClick={() => pindah({ selisih: !selisih })}>
          {t("kantor.hanyaSelisih", { n: data.selisihTerbuka })}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {STATUS_MUTASI.map((s) => (
          <Button
            key={s}
            variant="outline"
            aria-pressed={status === s}
            onClick={() => pindah({ status: status === s ? null : s })}
            className={cn(
              "h-auto flex-col items-start justify-between gap-0.5 whitespace-normal px-4 py-3 text-left",
              status === s && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
            {/* mt-auto: label dua baris tidak menurunkan angkanya — semua angka sejajar di bawah. */}
            <span className="mt-auto text-lg font-semibold tabular-nums">{data.perStatus[s]}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            {t("kantor.daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title={disaring ? t("kantor.kosongSaringJudul") : t("kantor.kosongJudul")}
              description={disaring ? t("kantor.kosongSaringIsi") : t("kantor.kosongIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kantor.kolom.nomor")}</TableHead>
                    <TableHead>{t("kantor.kolom.rute")}</TableHead>
                    <TableHead>{t("kantor.kolom.pengaju")}</TableHead>
                    <TableHead className="text-right">{t("kantor.kolom.isi")}</TableHead>
                    <TableHead>{t("kantor.kolom.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id} className={cn((b.status === "DIAJUKAN" || b.selisihStatus === "TERBUKA" || b.macet) && "bg-amber-500/[0.05]")}>
                      <TableCell>
                        <Link href={`/backoffice/spg-transfers/${b.id}`} className="font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
                          {b.docNo}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.dibuat}</span>
                      </TableCell>
                      <TableCell className="min-w-[14rem] whitespace-normal">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span>{b.asal}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          <span>{b.tujuan}</span>
                        </span>
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">{b.pengaju}</TableCell>
                      <TableCell className="text-right tabular-nums">{t("isi", { baris: b.baris, pcs: b.pcs })}</TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        <span className="flex flex-wrap gap-1">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusMutasi(b.status))}>{td(`status.${b.status}`)}</span>
                          {b.selisihStatus === "TERBUKA" ? (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t("selisihTerbuka")}</span>
                          ) : null}
                          {b.macet ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{t("kantor.macet")}</span>
                          ) : null}
                        </span>
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
