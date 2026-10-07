"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import type { BarisKolaborasi } from "@/lib/creative/kolaborasi-queries";
import type { Tahap } from "@/lib/creative/tahap";
import { cn } from "@/lib/utils";
import { PilihTahapInline, PilTahap, subKol, TenggatSingkat, UmurTahap } from "./bagian";
import type { SasaranPindah } from "./usePindahTahap";

export const RUTE_KOLABORASI = "/backoffice/kreatif/kolaborasi";

/**
 * Tabel kolaborasi — dipakai daftar Kolaborasi dan rincian Campaign.
 *
 * Tahap diubah langsung di baris (`PilihTahapInline`); mundur/keluar meminta
 * alasan lewat `onPindah` (lihat `usePindahTahap`). Lebar dijaga untuk layar
 * 1280 px: campaign, resi, dan hasil ditumpuk di bawah kolom utama sampai 2xl.
 */
export function TabelKolaborasi({
  baris,
  hariIni,
  bolehMengelola,
  tahapDari,
  onPindah,
  dipilih,
  onPilih,
  tampilCampaign = true,
}: {
  baris: BarisKolaborasi[];
  hariIni: string;
  bolehMengelola: boolean;
  tahapDari: (id: string, asli: Tahap) => Tahap;
  onPindah: (sasaran: SasaranPindah[], ke: Tahap) => void;
  /** Tanpa `dipilih`/`onPilih` kolom centang tidak tampil. */
  dipilih?: ReadonlySet<string>;
  onPilih?: (ids: string[], pilih: boolean) => void;
  tampilCampaign?: boolean;
}) {
  const t = useTranslations("kreatifRuang.kolaborasi");
  const bisaPilih = Boolean(dipilih && onPilih) && bolehMengelola;
  const semuaDipilih = bisaPilih && baris.length > 0 && baris.every((b) => dipilih!.has(b.id));
  const sebagian = bisaPilih && !semuaDipilih && baris.some((b) => dipilih!.has(b.id));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {bisaPilih ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={semuaDipilih ? true : sebagian ? "indeterminate" : false}
                  onCheckedChange={(v) => onPilih!(baris.map((b) => b.id), v === true)}
                  aria-label={t("pilihSemua")}
                />
              </TableHead>
            ) : null}
            <TableHead className="min-w-[200px]">{t("kolom.kol")}</TableHead>
            {tampilCampaign ? <TableHead className="hidden min-w-[140px] 2xl:table-cell">{t("kolom.campaign")}</TableHead> : null}
            <TableHead>{t("kolom.tahap")}</TableHead>
            <TableHead>{t("kolom.umur")}</TableHead>
            <TableHead className="min-w-[140px]">{t("kolom.tenggat")}</TableHead>
            <TableHead className="hidden 2xl:table-cell">{t("kolom.resi")}</TableHead>
            <TableHead className="text-right">{t("kolom.hasil")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("kolom.aksi")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => {
            const tahap = tahapDari(b.id, b.tahap);
            const sasaran: SasaranPindah = { id: b.id, tahap, kolNama: b.kol.name };
            return (
              <TableRow key={b.id} data-state={dipilih?.has(b.id) ? "selected" : undefined}>
                {bisaPilih ? (
                  <TableCell>
                    <Checkbox
                      checked={dipilih!.has(b.id)}
                      onCheckedChange={(v) => onPilih!([b.id], v === true)}
                      aria-label={t("pilihBaris", { docNo: b.docNo })}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-normal">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`${RUTE_KOLABORASI}/${b.id}`} className="font-medium hover:underline">
                        {b.kol.name}
                      </Link>
                      {b.kol.diblokir ? <StatusPill tone="attention">{t("diblokir")}</StatusPill> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{subKol(b.kol) || b.docNo}</p>
                    {tampilCampaign && b.campaign ? (
                      <p className="truncate text-xs text-muted-foreground 2xl:hidden">{b.campaign.name}</p>
                    ) : null}
                  </div>
                </TableCell>
                {tampilCampaign ? (
                  <TableCell className="hidden whitespace-normal 2xl:table-cell">
                    {b.campaign ? (
                      <Link href={`/backoffice/kreatif/campaign/${b.campaign.id}`} className="text-sm hover:underline">
                        {b.campaign.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  {bolehMengelola ? (
                    <PilihTahapInline
                      tahap={tahap}
                      ariaLabel={t("tahapAria", { docNo: b.docNo })}
                      onPilih={(ke) => onPindah([sasaran], ke)}
                    />
                  ) : (
                    <PilTahap tahap={tahap} />
                  )}
                </TableCell>
                <TableCell>
                  <UmurTahap hari={b.umurHari} merah={b.umurMerah && tahap === b.tahap} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <TenggatSingkat tenggat={b.tenggat} hariIni={hariIni} />
                  {b.resi ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground 2xl:hidden">
                      {[b.resi.courier, b.resi.trackingNo].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="hidden 2xl:table-cell">
                  {b.resi ? (
                    <span className="text-sm">
                      {b.resi.courier ? <span className="text-muted-foreground">{b.resi.courier} · </span> : null}
                      <span className="tabular-nums">{b.resi.trackingNo}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="text-sm tabular-nums">{angkaTitik(b.views)}</div>
                  <div className={cn("text-xs tabular-nums", b.gmv > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                    {rupiahTeks(b.gmv)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <TombolWa kolId={b.kol.id} kolaborasiId={b.id} bolehMengelola={bolehMengelola} />
                    <Button asChild variant="ghost" size="icon" aria-label={t("bukaAria", { docNo: b.docNo })} title={t("buka")}>
                      <Link href={`${RUTE_KOLABORASI}/${b.id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
