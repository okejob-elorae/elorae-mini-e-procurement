"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Undo2 } from "lucide-react";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { STATUS_RETUR_PEMBELI, type SaringanReturPembeliKantor, type StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";
import { cn } from "@/lib/utils";
import { NADA_STATUS_RETUR_PEMBELI } from "./tampilan";

const SEMUA_TOKO = "__semua__";
const TAB: readonly (StatusReturPembeli | "SEMUA")[] = [...STATUS_RETUR_PEMBELI, "SEMUA"];

/** Baris antrean yang sudah diformat di server (tanggal WIB). */
export type BarisReturPembeliTampil = {
  id: string;
  status: StatusReturPembeli;
  dilaporkan: string;
  toko: string;
  pelapor: string;
  spgSaleId: string;
  docNo: string;
  pcs: number;
  ringkasBarang: string;
  alasan: string;
  diputuskanOleh: string | null;
  diputuskan: string | null;
  alasanTolak: string | null;
  langsungBerlaku: boolean;
};

export function DaftarReturPembeliClient({
  saringan,
  baris,
  total,
  perStatus,
  toko,
  bolehMemutuskan,
}: {
  saringan: SaringanReturPembeliKantor;
  baris: BarisReturPembeliTampil[];
  total: number;
  perStatus: Record<StatusReturPembeli, number>;
  toko: { id: string; name: string }[];
  /** `spg_returns:approve` — hanya untuk kalimat penjelas; tombolnya di halaman rincian. */
  bolehMemutuskan: boolean;
}) {
  const t = useTranslations("spgReturPembeli");
  const td = dinamis(t);
  const router = useRouter();
  const [memuat, mulai] = useTransition();
  const [cari, setCari] = useState(saringan.cari);

  // Semua kunci saringan ditulis dalam SATU navigasi — dua dorongan berurutan saling menimpa.
  const pindah = (ubah: { status?: string; toko?: string | null; cari?: string; halaman?: number }) => {
    const q = new URLSearchParams();
    const status = ubah.status ?? saringan.status;
    const tk = ubah.toko !== undefined ? ubah.toko : saringan.storeId;
    const c = (ubah.cari ?? saringan.cari).trim();
    // Pindah tab, toko, atau pencarian kembali ke halaman pertama.
    const halaman = ubah.halaman ?? 1;
    if (status !== "MENUNGGU") q.set("status", status);
    if (tk) q.set("toko", tk);
    if (c) q.set("cari", c);
    if (halaman > 1) q.set("halaman", String(halaman));
    const qs = q.toString();
    mulai(() => router.replace(qs ? `/backoffice/retur-spg?${qs}` : "/backoffice/retur-spg"));
  };

  const jumlahTab = (s: StatusReturPembeli | "SEMUA") =>
    s === "SEMUA" ? STATUS_RETUR_PEMBELI.reduce((n, x) => n + perStatus[x], 0) : perStatus[s];
  const totalHalaman = Math.max(1, Math.ceil(total / saringan.ukuran));
  const disaring = saringan.storeId !== null || saringan.cari !== "";
  const tokoPilihan =
    saringan.storeId && !toko.some((x) => x.id === saringan.storeId) ? [...toko, { id: saringan.storeId, name: saringan.storeId }] : toko;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-1">
            {t("kantor.judul")}
            <TombolBantuan judul={t("kantor.judul")} />
          </span>
        }
        meta={t("kantor.ringkas", { menunggu: perStatus.MENUNGGU })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={saringan.storeId ?? SEMUA_TOKO} onValueChange={(v) => pindah({ toko: v === SEMUA_TOKO ? null : v })}>
          <SelectTrigger className="w-full sm:w-64" aria-label={t("kantor.saringToko")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA_TOKO}>{t("kantor.semuaToko")}</SelectItem>
            {tokoPilihan.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="relative w-full sm:w-72"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            pindah({ cari });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("kantor.cari")}
            aria-label={t("kantor.cari")}
            maxLength={64}
            className="pl-9"
          />
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label={t("kantor.saringStatus")}>
        {TAB.map((s) => {
          const aktif = saringan.status === s;
          return (
            <Button
              key={s}
              variant="outline"
              role="tab"
              aria-selected={aktif}
              disabled={memuat}
              onClick={() => pindah({ status: s })}
              className={cn(
                "h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left",
                aktif && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
              <span className="text-lg font-semibold tabular-nums">{jumlahTab(s)}</span>
            </Button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            {t("kantor.daftarJudul")}
          </CardTitle>
          {saringan.status === "MENUNGGU" && perStatus.MENUNGGU > 0 ? (
            <p className="text-sm text-muted-foreground">{bolehMemutuskan ? t("kantor.menungguBoleh") : t("kantor.menungguLihat")}</p>
          ) : null}
        </CardHeader>
        <CardContent className={baris.length === 0 ? undefined : "px-0"}>
          {baris.length === 0 ? (
            <EmptyState
              icon={Undo2}
              title={disaring ? t("kantor.kosongSaringJudul") : t("kantor.kosong")}
              description={disaring ? t("kantor.kosongSaringIsi") : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kantor.kolom.dilaporkan")}</TableHead>
                    <TableHead>{t("kantor.kolom.toko")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kantor.kolom.spg")}</TableHead>
                    <TableHead>{t("kantor.kolom.nota")}</TableHead>
                    <TableHead>{t("kantor.kolom.barang")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kantor.kolom.alasan")}</TableHead>
                    <TableHead>{t("kantor.kolom.status")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kantor.kolom.diputuskan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id} className={cn(b.status === "MENUNGGU" && "bg-amber-500/[0.05]")}>
                      <TableCell>
                        <Link href={`/backoffice/retur-spg/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                          {b.dilaporkan}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">{b.toko}</TableCell>
                      <TableCell className="hidden min-w-[8rem] whitespace-normal 2xl:table-cell">{b.pelapor}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/backoffice/spg-sales/${b.spgSaleId}`} className="text-primary underline-offset-2 hover:underline">
                          {b.docNo}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-[14rem] whitespace-normal">
                        <span className="block font-medium tabular-nums">{t("kantor.pcs", { n: b.pcs })}</span>
                        <span className="block text-xs text-muted-foreground">{b.ringkasBarang}</span>
                      </TableCell>
                      <TableCell className="hidden min-w-[12rem] whitespace-normal 2xl:table-cell">{b.alasan}</TableCell>
                      <TableCell>
                        <StatusPill tone={NADA_STATUS_RETUR_PEMBELI[b.status]}>{td(`status.${b.status}`)}</StatusPill>
                      </TableCell>
                      <TableCell className="hidden min-w-[10rem] whitespace-normal text-sm 2xl:table-cell">
                        {b.langsungBerlaku ? (
                          <span className="text-muted-foreground">{t("kantor.langsungBerlaku")}</span>
                        ) : b.diputuskan ? (
                          <>
                            <span className="block">{t("rincian.diputuskan", { oleh: b.diputuskanOleh ?? "—", pada: b.diputuskan })}</span>
                            {b.alasanTolak ? <span className="block text-xs text-muted-foreground">{b.alasanTolak}</span> : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {total > saringan.ukuran ? (
            <div className="px-6">
              <Pagination
                page={saringan.halaman}
                totalPages={totalHalaman}
                totalCount={total}
                pageSize={saringan.ukuran}
                disabled={memuat}
                onPageChange={(halaman) => pindah({ halaman })}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
