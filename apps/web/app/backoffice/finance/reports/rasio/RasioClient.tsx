"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Gauge, ListTree } from "lucide-react";
import type { LaporanRasio } from "@/lib/finance/reports/rasio-queries";
import type { HasilRasio } from "@/lib/finance/reports/rasio";
import type { RentangTanggal } from "@/lib/finance/reports/periode-banding";
import { hariLaporan, persenLaporan, rasioLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { exportRasioExcel } from "@/app/actions/finance-laporan";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import type { KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";
import { EksporLaporan } from "../_lanjutan/EksporLaporan";
import { CatatanCakupan } from "../_lanjutan/CatatanCakupan";

type Props = {
  laporan: LaporanRasio;
  filters: { dari: string; sampai: string };
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
  bolehKlasifikasi: boolean;
};

type BarisRasio = { kunci: string; tampil: (r: HasilRasio) => string };

export function RasioClient({ laporan, filters, kesiapan, akses, bolehKlasifikasi }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("laporanLanjutan.rasio");
  const tr = useTranslations("financeReports");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const tgl = (s: string) => formatDisplayDate(parseDateOnly(s), locale);
  const rentang = (r: RentangTanggal) => `${tgl(r.dari)} – ${tgl(r.sampai)}`;
  const hari = t("satuanHari");

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`/backoffice/finance/reports/rasio?${params.toString()}`));
  }

  const rasio: BarisRasio[] = [
    { kunci: "marginKotor", tampil: (r) => persenLaporan(r.marginKotor) },
    { kunci: "marginBersih", tampil: (r) => persenLaporan(r.marginBersih) },
    { kunci: "rasioLancar", tampil: (r) => rasioLaporan(r.rasioLancar) },
    { kunci: "rasioCepat", tampil: (r) => rasioLaporan(r.rasioCepat) },
    { kunci: "perputaranPersediaan", tampil: (r) => rasioLaporan(r.perputaranPersediaan) },
    { kunci: "hariPersediaan", tampil: (r) => hariLaporan(r.hariPersediaan, hari) },
    { kunci: "dso", tampil: (r) => hariLaporan(r.dso, hari) },
    { kunci: "dpo", tampil: (r) => hariLaporan(r.dpo, hari) },
  ];

  const komponen: { kunci: keyof HasilRasio["komponen"]; hari?: boolean }[] = [
    { kunci: "pendapatan" },
    { kunci: "hpp" },
    { kunci: "labaKotor" },
    { kunci: "labaBersih" },
    { kunci: "asetLancar" },
    { kunci: "persediaan" },
    { kunci: "dibayarDimuka" },
    { kunci: "asetCepat" },
    { kunci: "liabilitasLancar" },
    { kunci: "rataPersediaan" },
    { kunci: "rataPiutang" },
    { kunci: "rataHutang" },
    { kunci: "hari", hari: true },
  ];

  const qs = new URLSearchParams({ dari: filters.dari, sampai: filters.sampai }).toString();
  const takTerklasifikasi = laporan.ini.komponen.akunTakTerklasifikasi;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={tr("periode.range", { dari: tgl(laporan.periode.dari), sampai: tgl(laporan.periode.sampai) })}
        actions={<EksporLaporan ekspor={() => exportRasioExcel(filters)} hrefCetak={`/print/finance/rasio?${qs}`} />}
      />

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
            <RentangTanggalInput
              id="periode"
              dari={filters.dari}
              sampai={filters.sampai}
              onChange={({ dari, sampai }) => pushParams({ dari: dari || undefined, sampai: sampai || undefined })}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" disabled={isPending} onClick={() => startTransition(() => router.push("/backoffice/finance/reports/rasio"))}>
              {tr("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      {takTerklasifikasi > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            {t("takTerklasifikasi", { jumlah: takTerklasifikasi, nilai: rupiahLaporan(laporan.ini.komponen.asetTakTerklasifikasi) })}{" "}
            {bolehKlasifikasi ? (
              <Link href="/backoffice/finance/cash-flow-sections" className="underline underline-offset-4">
                {t("bukaKlasifikasi")}
              </Link>
            ) : null}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            {t("judulTabel")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomRasio")}</TableHead>
                  <TableHead className="text-right">{rentang(laporan.periode)}</TableHead>
                  <TableHead className="text-right">{rentang(laporan.sebelumnya)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rasio.map((r) => (
                  <TableRow key={r.kunci}>
                    <TableCell className="font-medium">{t(`nama.${r.kunci}`)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{r.tampil(laporan.ini)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.tampil(laporan.lalu)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTree className="h-5 w-5" />
            {t("judulKomponen")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomKomponen")}</TableHead>
                  <TableHead className="text-right">{rentang(laporan.periode)}</TableHead>
                  <TableHead className="text-right">{rentang(laporan.sebelumnya)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {komponen.map((k) => (
                  <TableRow key={k.kunci}>
                    <TableCell>{t(`komponen.${k.kunci}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {k.hari ? hariLaporan(laporan.ini.komponen.hari, hari) : rupiahLaporan(laporan.ini.komponen[k.kunci] as number)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {k.hari ? hariLaporan(laporan.lalu.komponen.hari, hari) : rupiahLaporan(laporan.lalu.komponen[k.kunci] as number)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <CatatanCakupan />
        </CardContent>
      </Card>
    </div>
  );
}
