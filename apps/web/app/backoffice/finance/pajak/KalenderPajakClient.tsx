"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import type { ButirBerstatus, SaringKalender, StatusBayar } from "@/lib/finance/pajak/kalender";
import { NavPajak, SpandukPajak, type AksesPajak } from "./_bersama/NavPajak";
import { labelMasa } from "./_bersama/akses";

type Props = {
  butir: ButirBerstatus[];
  jumlah: Record<SaringKalender, number>;
  saring: SaringKalender;
  hariIni: string;
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak & { kelola: boolean };
  gagal: boolean;
};

const NADA: Record<StatusBayar, StatusTone> = {
  LUNAS: "settled",
  NIHIL: "inactive",
  SEBAGIAN: "progress",
  BELUM: "waiting",
  TANPA_ANGKA: "inactive",
  INFO: "inactive",
};

function selisihHari(dari: string, ke: string): number {
  return Math.round((Date.parse(`${ke}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);
}

export function KalenderPajakClient({ butir, jumlah, saring, hariIni, statusPkp, rezimPph, akses, gagal }: Props) {
  const t = useTranslations("financeTax.kalender");
  const tp = useTranslations("financeTax.pajak");
  const locale = useLocale();

  const tautanAksi = (b: ButirBerstatus) => {
    if (b.jenis !== "SETOR") return null;
    if (b.pajak === "PPN" && b.perkiraan) return { href: `/backoffice/finance/pajak/ppn?masa=${b.masa}`, label: t("aksi.rekap") };
    if (b.pajak === "PPH_FINAL" && b.terutang == null) return { href: `/backoffice/finance/pajak/pph-final?tahun=${b.masa.slice(0, 4)}`, label: t("aksi.hitung") };
    if (akses.kelola && (b.sisa == null ? b.status !== "LUNAS" : b.sisa > 0)) {
      const qs = new URLSearchParams({ baru: "1", jenis: b.pajak, masa: b.masa });
      if (b.sisa) qs.set("jumlah", String(Math.round(b.sisa)));
      return { href: `/backoffice/finance/pajak/setoran?${qs.toString()}`, label: t("aksi.setor") };
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={t("meta", { n: jumlah.semua, perlu: jumlah.segera + jumlah.lewat })} />
      <NavPajak aktif="kalender" akses={akses} />
      <SpandukPajak statusPkp={statusPkp} rezimPph={rezimPph} akses={akses} />

      <div className="flex flex-wrap gap-2">
        {(["semua", "segera", "lewat"] as const).map((s) => (
          <Button key={s} asChild size="sm" variant={s === saring ? "default" : "outline"}>
            <Link href={s === "semua" ? "/backoffice/finance/pajak" : `/backoffice/finance/pajak?saring=${s}`} replace>
              {t(`saring.${s}`, { n: jumlah[s] })}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" aria-hidden />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gagal ? (
            <p className="text-sm text-destructive">{t("gagal")}</p>
          ) : butir.length === 0 ? (
            <EmptyState icon={CalendarClock} title={t(`kosong.${saring}`)} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.jatuhTempo")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("kolom.kewajiban")}</TableHead>
                    <TableHead>{t("kolom.masa")}</TableHead>
                    <TableHead className="text-right">{t("kolom.terutang")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.disetor")}</TableHead>
                    <TableHead className="text-right">{t("kolom.sisa")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {butir.map((b) => {
                    const hari = selisihHari(hariIni, b.jatuhTempo);
                    const aksi = tautanAksi(b);
                    return (
                      <TableRow key={b.kunci}>
                        <TableCell className="whitespace-normal">
                          <span className="tabular-nums">{labelTanggal(b.jatuhTempo, locale)}</span>
                          <span
                            className={
                              b.tenggat === "LEWAT" && b.perluTindakan
                                ? "block text-xs text-red-700 dark:text-red-300"
                                : b.tenggat === "SEGERA" && b.perluTindakan
                                  ? "block text-xs text-amber-700 dark:text-amber-300"
                                  : "block text-xs text-muted-foreground"
                            }
                          >
                            {hari < 0 ? t("lewatHari", { n: -hari }) : hari === 0 ? t("hariIni") : t("lagiHari", { n: hari })}
                            {b.jatuhTempo !== b.jatuhTempoAturan ? ` · ${t("digeser")}` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="font-medium">{t(`jenis.${b.jenis}`)}</span> {tp(b.pajak)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap capitalize">{labelMasa(b.masa, locale)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.terutang == null ? "—" : formatRupiah(b.terutang)}
                          {b.perkiraan ? <span className="block text-xs text-muted-foreground">{t("perkiraan")}</span> : null}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{b.jenis === "SETOR" ? formatRupiah(b.disetor) : "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{b.sisa == null ? "—" : formatRupiah(b.sisa)}</TableCell>
                        <TableCell>
                          <StatusPill tone={b.perluTindakan && b.tenggat === "LEWAT" ? "attention" : NADA[b.status]}>{t(`status.${b.status}`)}</StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          {aksi ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={aksi.href}>{aksi.label}</Link>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
