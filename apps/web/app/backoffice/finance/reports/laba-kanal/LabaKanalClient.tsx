"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Store } from "lucide-react";
import type { LaporanLabaKanal } from "@/lib/finance/reports/laba-kanal-queries";
import type { BarisLabaKanal } from "@/lib/finance/reports/laba-kanal";
import type { RentangTanggal } from "@/lib/finance/reports/periode-banding";
import type { KelompokLabaKanal } from "@/lib/finance/reports/param-laporan";
import { SEMUA_KANAL_JURNAL, labelKanalJurnal, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { persenLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { exportLabaKanalExcel } from "@/app/actions/finance-laporan";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import type { KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";
import { EksporLaporan } from "../_lanjutan/EksporLaporan";
import { CatatanCakupan } from "../_lanjutan/CatatanCakupan";

type Props = {
  laporan: LaporanLabaKanal;
  periode: RentangTanggal;
  filters: { dari: string; sampai: string; kelompok: KelompokLabaKanal; kanal: KanalJurnal | null };
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
};

function SelAngka({ b }: { b: BarisLabaKanal }) {
  const merah = (n: number) => (n < 0 ? "text-destructive" : "");
  return (
    <>
      <TableCell className="text-right tabular-nums hidden 2xl:table-cell">{rupiahLaporan(b.penjualan)}</TableCell>
      <TableCell className="text-right tabular-nums hidden 2xl:table-cell">{rupiahLaporan(b.retur)}</TableCell>
      <TableCell className="text-right tabular-nums hidden 2xl:table-cell">{rupiahLaporan(b.potongan)}</TableCell>
      <TableCell className="text-right tabular-nums">{rupiahLaporan(b.pendapatanBersih)}</TableCell>
      <TableCell className="text-right tabular-nums">{rupiahLaporan(b.hpp)}</TableCell>
      <TableCell className={`text-right tabular-nums ${merah(b.labaKotor)}`}>{rupiahLaporan(b.labaKotor)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{persenLaporan(b.marginKotor)}</TableCell>
      <TableCell className="text-right tabular-nums">{rupiahLaporan(b.beban)}</TableCell>
      <TableCell className={`text-right tabular-nums font-medium ${merah(b.labaKontribusi)}`}>{rupiahLaporan(b.labaKontribusi)}</TableCell>
    </>
  );
}

export function LabaKanalClient({ laporan, periode, filters, kesiapan, akses }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("laporanLanjutan.labaKanal");
  const tr = useTranslations("financeReports");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const tgl = (s: string) => formatDisplayDate(parseDateOnly(s), locale);
  const perToko = filters.kelompok === "toko";

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`/backoffice/finance/reports/laba-kanal?${params.toString()}`));
  }

  const label = (kunci: string | null) =>
    perToko ? (kunci ? (laporan.namaToko[kunci] ?? kunci) : t("tanpaToko")) : kunci ? labelKanalJurnal(kunci) : t("tanpaKanal");

  const qs = new URLSearchParams({
    dari: filters.dari,
    sampai: filters.sampai,
    kelompok: filters.kelompok,
    kanal: filters.kanal ?? "",
  }).toString();

  return (
    <div className="space-y-6">
      <PageHeader
        title={perToko ? t("judulToko") : t("judulKanal")}
        meta={tr("periode.range", { dari: tgl(periode.dari), sampai: tgl(periode.sampai) })}
        actions={
          <EksporLaporan
            ekspor={() => exportLabaKanalExcel({ dari: filters.dari, sampai: filters.sampai, kelompok: filters.kelompok, kanal: filters.kanal ?? undefined })}
            hrefCetak={`/print/finance/laba-kanal?${qs}`}
          />
        }
      />

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Tabs value={filters.kelompok} onValueChange={(v) => pushParams({ kelompok: v === "toko" ? "toko" : undefined, kanal: undefined })}>
        <TabsList>
          <TabsTrigger value="kanal">{t("tabKanal")}</TabsTrigger>
          <TabsTrigger value="toko">{t("tabToko")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
            <RentangTanggalInput
              id="periode"
              dari={filters.dari}
              sampai={filters.sampai}
              onChange={({ dari, sampai }) => pushParams({ dari: dari || undefined, sampai: sampai || undefined })}
            />
          </div>
          {perToko ? (
            <div>
              <label htmlFor="kanal" className="text-xs text-muted-foreground mb-1 block">{t("saringKanal")}</label>
              <Select value={filters.kanal ?? "SEMUA"} onValueChange={(v) => pushParams({ kanal: v === "SEMUA" ? undefined : v })}>
                <SelectTrigger id="kanal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEMUA">{t("semuaKanal")}</SelectItem>
                  {SEMUA_KANAL_JURNAL.map((k) => (
                    <SelectItem key={k} value={k}>
                      {labelKanalJurnal(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex items-end">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => router.push(`/backoffice/finance/reports/laba-kanal${perToko ? "?kelompok=toko" : ""}`))}
            >
              {tr("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {perToko ? t("judulToko") : t("judulKanal")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {laporan.baris.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t("kosong")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">{perToko ? t("kolomToko") : t("kolomKanal")}</TableHead>
                    <TableHead className="text-right hidden 2xl:table-cell">{t("kolomPenjualan")}</TableHead>
                    <TableHead className="text-right hidden 2xl:table-cell">{t("kolomRetur")}</TableHead>
                    <TableHead className="text-right hidden 2xl:table-cell">{t("kolomPotongan")}</TableHead>
                    <TableHead className="text-right">{t("kolomPendapatanBersih")}</TableHead>
                    <TableHead className="text-right">{t("kolomHpp")}</TableHead>
                    <TableHead className="text-right">{t("kolomLabaKotor")}</TableHead>
                    <TableHead className="text-right">{t("kolomMargin")}</TableHead>
                    <TableHead className="text-right">{t("kolomBeban")}</TableHead>
                    <TableHead className="text-right">{t("kolomLabaKontribusi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {laporan.baris.map((b) => (
                    <TableRow key={b.kunci ?? "tanpa"}>
                      <TableCell className={`whitespace-normal ${b.kunci === null ? "italic text-muted-foreground" : "font-medium"}`}>{label(b.kunci)}</TableCell>
                      <SelAngka b={b} />
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell>{t("total")}</TableCell>
                    <SelAngka b={laporan.total} />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          {laporan.barisTurunan > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{t("barisTurunan", { jumlah: laporan.barisTurunan })}</p>
          ) : null}
          <CatatanCakupan />
        </CardContent>
      </Card>
    </div>
  );
}
