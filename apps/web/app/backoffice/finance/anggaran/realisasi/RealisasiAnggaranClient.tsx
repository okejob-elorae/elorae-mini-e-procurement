"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilLine, Target } from "lucide-react";
import type { AccountType } from "@/lib/constants/enums";
import type { LaporanAnggaran } from "@/lib/finance/anggaran/queries";
import { BULAN, capaianAnggaran } from "@/lib/finance/anggaran/aturan";
import { barisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import { persenLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { exportAnggaranExcel } from "@/app/actions/finance-laporan";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import type { KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";
import { EksporLaporan } from "../../reports/_lanjutan/EksporLaporan";
import { CatatanCakupan } from "../../reports/_lanjutan/CatatanCakupan";

type Props = {
  laporan: LaporanAnggaran;
  pilihan: { tahun: number; bulan: number; cakupan: "bulan" | "ytd"; nol: boolean };
  tahunPilihan: number[];
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
  bolehIsi: boolean;
};

function SelCapaian({ type, anggaran, realisasi, beranggaran, tebal }: { type: AccountType; anggaran: number; realisasi: number; beranggaran: boolean; tebal?: boolean }) {
  const tc = useTranslations("anggaran.realisasi");
  const c = capaianAnggaran(type, beranggaran ? anggaran : null, realisasi);
  const kelas = `text-right tabular-nums ${tebal ? "font-semibold" : ""}`;
  const warna = c.baik === true ? "text-emerald-700 dark:text-emerald-400" : c.baik === false ? "text-destructive" : "text-muted-foreground";
  return (
    <>
      <TableCell className={kelas}>{beranggaran ? rupiahLaporan(anggaran) : "—"}</TableCell>
      <TableCell className={kelas}>{rupiahLaporan(realisasi)}</TableCell>
      <TableCell className={`${kelas} ${beranggaran ? warna : "text-muted-foreground"}`}>{beranggaran ? rupiahLaporan(c.selisih) : "—"}</TableCell>
      <TableCell className={`${kelas} ${warna}`}>
        {c.persenCapaian === null ? "—" : persenLaporan(c.persenCapaian)}
        {c.baik !== null ? <span className="sr-only"> {c.baik ? tc("baik") : tc("buruk")}</span> : null}
      </TableCell>
    </>
  );
}

export function RealisasiAnggaranClient({ laporan, pilihan, tahunPilihan, kesiapan, akses, bolehIsi }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("anggaran");
  const tr = useTranslations("financeReports");
  const tk = useTranslations("financeReports.kolom");
  const [isPending, startTransition] = useTransition();
  const beranggaran = new Set(laporan.akunBeranggaran);

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`/backoffice/finance/anggaran/realisasi?${params.toString()}`));
  }

  const namaBulan = (b: number) => t(`bulanPanjang.${b}`);
  const meta =
    pilihan.cakupan === "bulan"
      ? t("realisasi.metaBulan", { bulan: namaBulan(pilihan.bulan), tahun: pilihan.tahun })
      : t("realisasi.metaYtd", { sampai: namaBulan(pilihan.bulan), tahun: pilihan.tahun });
  const qs = new URLSearchParams({
    tahun: String(pilihan.tahun),
    bulan: String(pilihan.bulan),
    cakupan: pilihan.cakupan,
    nol: pilihan.nol ? "1" : "0",
  }).toString();
  // Dasar = jarak tepi tabel (lib/ui/tepi-tabel.ts) + 4px, supaya tingkat 0 sejajar dengan
  // judul kartu saat tabel menempel ke kartu, dan tetap 12px di tempat lain.
  const indent = (level: number) => ({ paddingLeft: `calc(var(--tabel-tepi, 0.5rem) + ${level * 20 + 4}px)` });

  const bagian = (judul: string, type: AccountType, akar: SimpulNilai[], total: [number, number], labelTotal: string) => {
    const baris = barisPohon(akar, { tampilkanNol: pilihan.nol });
    return [
      <TableRow key={`h-${type}`} className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={5} className="font-semibold uppercase text-xs tracking-wide">
          {judul}
        </TableCell>
      </TableRow>,
      ...(baris.length === 0
        ? [
            <TableRow key={`k-${type}`}>
              <TableCell colSpan={5} className="ps-[calc(var(--tabel-tepi,0.5rem)+1rem)] text-sm text-muted-foreground">
                {t("realisasi.bagianKosong")}
              </TableCell>
            </TableRow>,
          ]
        : baris.map((b) =>
            b.jenis === "judul" ? (
              <TableRow key={`j-${b.accountId}`}>
                <TableCell colSpan={5} className="font-medium" style={indent(b.level)}>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                  {b.name}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={`${b.jenis}-${b.accountId}`}>
                <TableCell className={b.jenis === "jumlah" ? "font-medium" : ""} style={indent(b.level)}>
                  {b.jenis === "jumlah" ? (
                    tk("jumlahKelompok", { nama: b.name })
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                      {b.name}
                    </>
                  )}
                </TableCell>
                <SelCapaian type={type} anggaran={b.nilai[0]} realisasi={b.nilai[1]} beranggaran={beranggaran.has(b.accountId)} tebal={b.jenis === "jumlah"} />
              </TableRow>
            ),
          )),
      <TableRow key={`s-${type}`} className="font-semibold">
        <TableCell className="ps-[calc(var(--tabel-tepi,0.5rem)+0.25rem)]">{labelTotal}</TableCell>
        <SelCapaian type={type} anggaran={total[0]} realisasi={total[1]} beranggaran={laporan.adaAnggaran} tebal />
      </TableRow>,
    ];
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("realisasi.judul")}
        meta={meta}
        actions={
          <>
            {bolehIsi ? (
              <Button variant="outline" asChild>
                <Link href={`/backoffice/finance/anggaran?tahun=${pilihan.tahun}`}>
                  <PencilLine className="mr-2 h-4 w-4" />
                  {t("realisasi.isiAnggaran")}
                </Link>
              </Button>
            ) : null}
            <EksporLaporan
              ekspor={() =>
                exportAnggaranExcel({ tahun: String(pilihan.tahun), bulan: String(pilihan.bulan), cakupan: pilihan.cakupan, nol: pilihan.nol ? "1" : "0" })
              }
              hrefCetak={`/print/finance/anggaran?${qs}`}
            />
          </>
        }
      />

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="tahun" className="text-xs text-muted-foreground mb-1 block">{t("pilihTahun")}</label>
            <Select value={String(pilihan.tahun)} onValueChange={(v) => pushParams({ tahun: v })}>
              <SelectTrigger id="tahun" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tahunPilihan.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="bulan" className="text-xs text-muted-foreground mb-1 block">{t("realisasi.pilihBulan")}</label>
            <Select value={String(pilihan.bulan)} onValueChange={(v) => pushParams({ bulan: v })}>
              <SelectTrigger id="bulan" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULAN.map((b) => (
                  <SelectItem key={b} value={String(b)}>
                    {namaBulan(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Tabs value={pilihan.cakupan} onValueChange={(v) => pushParams({ cakupan: v === "bulan" ? "bulan" : undefined })}>
            <TabsList>
              <TabsTrigger value="bulan">{t("realisasi.cakupanBulan")}</TabsTrigger>
              <TabsTrigger value="ytd">{t("realisasi.cakupanYtd")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="tampilNol" checked={pilihan.nol} disabled={isPending} onCheckedChange={(c) => pushParams({ nol: c === true ? "1" : undefined })} />
            <Label htmlFor="tampilNol" className="text-sm font-normal cursor-pointer">
              {tr("filter.showZeroAccounts")}
            </Label>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {t("realisasi.judulTabel")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!laporan.adaAnggaran && !laporan.adaRealisasi ? (
            <p className="py-12 text-center text-muted-foreground">{t("realisasi.kosong")}</p>
          ) : (
            <>
              {!laporan.adaAnggaran ? <p className="mb-3 text-sm text-muted-foreground">{t("realisasi.belumAdaAnggaran")}</p> : null}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">{tk("akun")}</TableHead>
                      <TableHead className="text-right">{t("realisasi.kolomAnggaran")}</TableHead>
                      <TableHead className="text-right">{t("realisasi.kolomRealisasi")}</TableHead>
                      <TableHead className="text-right">{t("realisasi.kolomSelisih")}</TableHead>
                      <TableHead className="text-right">{t("realisasi.kolomCapaian")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bagian(tr("incomeStatement.sectionPendapatan"), "PENDAPATAN", laporan.pendapatan, laporan.total.pendapatan, tr("incomeStatement.totalPendapatan"))}
                    {bagian(tr("incomeStatement.sectionHpp"), "HPP", laporan.hpp, laporan.total.hpp, tr("incomeStatement.totalHpp"))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>{tr("incomeStatement.labaKotor")}</TableCell>
                      <SelCapaian type="PENDAPATAN" anggaran={laporan.total.labaKotor[0]} realisasi={laporan.total.labaKotor[1]} beranggaran={laporan.adaAnggaran} tebal />
                    </TableRow>
                    {bagian(tr("incomeStatement.sectionBeban"), "BEBAN", laporan.beban, laporan.total.beban, tr("incomeStatement.totalBeban"))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>{tr("incomeStatement.labaBersih")}</TableCell>
                      <SelCapaian type="PENDAPATAN" anggaran={laporan.total.labaBersih[0]} realisasi={laporan.total.labaBersih[1]} beranggaran={laporan.adaAnggaran} tebal />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <CatatanCakupan />
        </CardContent>
      </Card>
    </div>
  );
}
