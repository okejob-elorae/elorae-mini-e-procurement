"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { GitCompareArrows } from "lucide-react";
import type { PerbandinganLabaRugi, PerbandinganNeraca } from "@/lib/finance/reports/perbandingan-queries";
import type { JenisPerbandingan } from "@/lib/finance/reports/param-laporan";
import type { RentangTanggal } from "@/lib/finance/reports/periode-banding";
import { barisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import { persenLaporan, rupiahLaporan, selisihPersen } from "@/lib/finance/reports/format-laporan";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { exportPerbandinganExcel } from "@/app/actions/finance-laporan";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { SpandukBukuBesar } from "../../_kesiapan/SpandukBukuBesar";
import type { KesiapanBukuBesar } from "../../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../../_kesiapan/baca";
import { tautanBukuBesar } from "../../journals/_sumber/tautan";
import { EksporLaporan } from "../_lanjutan/EksporLaporan";
import { CatatanCakupan } from "../_lanjutan/CatatanCakupan";

type Props = {
  jenis: JenisPerbandingan;
  laba: PerbandinganLabaRugi | null;
  neraca: PerbandinganNeraca | null;
  filters: { dari: string; sampai: string; tanggal: string; nol: boolean };
  periode: RentangTanggal;
  tanggal: string;
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
};

type Bagian = { judul: string; akar: SimpulNilai[]; total: number[]; labelTotal: string };
type BarisTambahan = { label: string; nilai: number[]; tebal?: boolean };

/** Tiga nilai + dua selisih: ini | sebelumnya | Δ | Δ% | tahun lalu | Δ | Δ%. Kolom Δ rupiah hanya di layar lebar. */
function SelBanding({ nilai, tebal }: { nilai: number[]; tebal?: boolean }) {
  const a = selisihPersen(nilai[0] ?? 0, nilai[1] ?? 0);
  const b = selisihPersen(nilai[0] ?? 0, nilai[2] ?? 0);
  const kelas = `text-right tabular-nums ${tebal ? "font-semibold" : ""}`;
  return (
    <>
      <TableCell className={kelas}>{rupiahLaporan(nilai[0])}</TableCell>
      <TableCell className={kelas}>{rupiahLaporan(nilai[1])}</TableCell>
      <TableCell className={`${kelas} hidden 2xl:table-cell`}>{rupiahLaporan(a.selisih)}</TableCell>
      <TableCell className={`${kelas} text-muted-foreground`}>{persenLaporan(a.persen)}</TableCell>
      <TableCell className={kelas}>{rupiahLaporan(nilai[2])}</TableCell>
      <TableCell className={`${kelas} hidden 2xl:table-cell`}>{rupiahLaporan(b.selisih)}</TableCell>
      <TableCell className={`${kelas} text-muted-foreground`}>{persenLaporan(b.persen)}</TableCell>
    </>
  );
}

function TabelBanding({
  kolom,
  bagian,
  nol,
  tautan,
}: {
  kolom: [string, string, string];
  bagian: (Bagian | BarisTambahan)[];
  nol: boolean;
  tautan?: (accountId: string) => string;
}) {
  const tp = useTranslations("laporanLanjutan.perbandingan");
  const tk = useTranslations("financeReports.kolom");
  const indent = (level: number) => ({ paddingLeft: `${level * 20 + 12}px` });
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[220px]">{tk("akun")}</TableHead>
            <TableHead className="text-right">{kolom[0]}</TableHead>
            <TableHead className="text-right">{kolom[1]}</TableHead>
            <TableHead className="text-right hidden 2xl:table-cell">{tp("selisih")}</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">{kolom[2]}</TableHead>
            <TableHead className="text-right hidden 2xl:table-cell">{tp("selisih")}</TableHead>
            <TableHead className="text-right">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bagian.map((b, i) => {
            if (!("akar" in b)) {
              return (
                <TableRow key={`t-${i}`} className={b.tebal ? "border-t-2 font-bold" : ""}>
                  <TableCell className={b.tebal ? "" : "pl-6"}>{b.label}</TableCell>
                  <SelBanding nilai={b.nilai} tebal={b.tebal} />
                </TableRow>
              );
            }
            const baris = barisPohon(b.akar, { tampilkanNol: nol });
            return [
              <TableRow key={`h-${i}`} className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={8} className="font-semibold uppercase text-xs tracking-wide">
                  {b.judul}
                </TableCell>
              </TableRow>,
              ...(baris.length === 0
                ? [
                    <TableRow key={`k-${i}`}>
                      <TableCell colSpan={8} className="pl-6 text-sm text-muted-foreground">
                        {tp("bagianKosong")}
                      </TableCell>
                    </TableRow>,
                  ]
                : baris.map((r) => {
                    if (r.jenis === "judul") {
                      return (
                        <TableRow key={`j-${i}-${r.accountId}`}>
                          <TableCell colSpan={8} className="font-medium" style={indent(r.level)}>
                            <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>
                            {r.name}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const href = r.jenis === "akun" && !r.sendiriInduk && tautan ? tautan(r.accountId) : null;
                    return (
                      <TableRow key={`${r.jenis}-${i}-${r.accountId}`}>
                        <TableCell className={r.jenis === "jumlah" ? "font-medium" : ""} style={indent(r.level)}>
                          {r.jenis === "jumlah" ? (
                            tk("jumlahKelompok", { nama: r.name })
                          ) : (
                            <>
                              <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>
                              {href ? (
                                <Link href={href} className="underline underline-offset-4">
                                  {r.name}
                                </Link>
                              ) : (
                                r.name
                              )}
                            </>
                          )}
                        </TableCell>
                        <SelBanding nilai={r.nilai} tebal={r.jenis === "jumlah"} />
                      </TableRow>
                    );
                  })),
              <TableRow key={`s-${i}`} className="font-semibold">
                <TableCell className="pl-3">{b.labelTotal}</TableCell>
                <SelBanding nilai={b.total} tebal />
              </TableRow>,
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function PerbandinganClient({ jenis, laba, neraca, filters, periode, tanggal, kesiapan, akses }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("laporanLanjutan");
  const tr = useTranslations("financeReports");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const tgl = (s: string) => formatDisplayDate(parseDateOnly(s), locale);
  const rentang = (r: RentangTanggal) => `${tgl(r.dari)} – ${tgl(r.sampai)}`;

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`/backoffice/finance/reports/perbandingan?${params.toString()}`));
  }

  const qsCetak = new URLSearchParams({
    jenis,
    dari: filters.dari,
    sampai: filters.sampai,
    tanggal: filters.tanggal,
    nol: filters.nol ? "1" : "0",
  }).toString();

  const meta = jenis === "laba-rugi" ? tr("periode.range", { dari: tgl(periode.dari), sampai: tgl(periode.sampai) }) : tr("periode.asOf", { tanggal: tgl(tanggal) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("perbandingan.judul")}
        meta={meta}
        actions={
          <EksporLaporan
            ekspor={() => exportPerbandinganExcel({ jenis, dari: filters.dari, sampai: filters.sampai, tanggal: filters.tanggal, nol: filters.nol ? "1" : "0" })}
            hrefCetak={`/print/finance/perbandingan?${qsCetak}`}
          />
        }
      />

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} />

      <Tabs value={jenis} onValueChange={(v) => pushParams({ jenis: v === "neraca" ? "neraca" : undefined })}>
        <TabsList>
          <TabsTrigger value="laba-rugi">{t("perbandingan.tabLabaRugi")}</TabsTrigger>
          <TabsTrigger value="neraca">{t("perbandingan.tabNeraca")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {jenis === "laba-rugi" ? (
            <div>
              <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
              <RentangTanggalInput
                id="periode"
                dari={filters.dari}
                sampai={filters.sampai}
                onChange={({ dari, sampai }) => pushParams({ dari: dari || undefined, sampai: sampai || undefined })}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="tanggal" className="text-xs text-muted-foreground mb-1 block">{tr("filter.asOf")}</label>
              <TanggalInput id="tanggal" value={filters.tanggal} onChange={(e) => pushParams({ tanggal: e.target.value || undefined })} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <Checkbox
              id="tampilNol"
              checked={filters.nol}
              disabled={isPending}
              onCheckedChange={(c) => pushParams({ nol: c === true ? "1" : undefined })}
            />
            <Label htmlFor="tampilNol" className="text-sm font-normal cursor-pointer">
              {tr("filter.showZeroAccounts")}
            </Label>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => router.push(`/backoffice/finance/reports/perbandingan${jenis === "neraca" ? "?jenis=neraca" : ""}`))}
            >
              {tr("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            {jenis === "laba-rugi" ? t("perbandingan.judulLabaRugi") : t("perbandingan.judulNeraca")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {laba ? (
            !laba.adaMutasi ? (
              <p className="py-12 text-center text-muted-foreground">{t("perbandingan.kosongLabaRugi")}</p>
            ) : (
              <TabelBanding
                kolom={[rentang(laba.kolom[0]), rentang(laba.kolom[1]), rentang(laba.kolom[2])]}
                nol={filters.nol}
                tautan={akses.jurnal ? (id) => tautanBukuBesar(id, periode) : undefined}
                bagian={[
                  { judul: tr("incomeStatement.sectionPendapatan"), akar: laba.pendapatan, total: laba.total.pendapatan, labelTotal: tr("incomeStatement.totalPendapatan") },
                  { judul: tr("incomeStatement.sectionHpp"), akar: laba.hpp, total: laba.total.hpp, labelTotal: tr("incomeStatement.totalHpp") },
                  { label: tr("incomeStatement.labaKotor"), nilai: laba.total.labaKotor, tebal: true },
                  { judul: tr("incomeStatement.sectionBeban"), akar: laba.beban, total: laba.total.beban, labelTotal: tr("incomeStatement.totalBeban") },
                  { label: tr("incomeStatement.labaBersih"), nilai: laba.total.labaBersih, tebal: true },
                ]}
              />
            )
          ) : neraca ? (
            !neraca.adaJurnal[0] ? (
              <p className="py-12 text-center text-muted-foreground">{tr("balanceSheet.empty")}</p>
            ) : (
              <>
                <TabelBanding
                  kolom={[tr("periode.asOf", { tanggal: tgl(neraca.kolom[0]) }), tr("periode.asOf", { tanggal: tgl(neraca.kolom[1]) }), tr("periode.asOf", { tanggal: tgl(neraca.kolom[2]) })]}
                  nol={filters.nol}
                  tautan={akses.jurnal ? (id) => tautanBukuBesar(id, { dari: null, sampai: tanggal }) : undefined}
                  bagian={[
                    { judul: tr("balanceSheet.sectionAset"), akar: neraca.aset, total: neraca.total.aset, labelTotal: tr("balanceSheet.totalAset") },
                    { judul: tr("balanceSheet.sectionLiabilitas"), akar: neraca.liabilitas, total: neraca.total.liabilitas, labelTotal: tr("balanceSheet.totalLiabilitas") },
                    { judul: tr("balanceSheet.sectionEkuitas"), akar: neraca.ekuitas, total: neraca.total.ekuitas, labelTotal: tr("balanceSheet.totalEkuitas") },
                    ...(neraca.total.labaTahunLalu.some((v) => v !== 0) ? [{ label: tr("balanceSheet.labaTahunLalu"), nilai: neraca.total.labaTahunLalu }] : []),
                    { label: tr("balanceSheet.labaTahunBerjalan"), nilai: neraca.total.labaTahunBerjalan },
                    { label: tr("balanceSheet.totalLiabilitasEkuitas"), nilai: neraca.total.liabilitasEkuitas, tebal: true },
                  ]}
                />
                {neraca.seimbang.some((s, i) => !s && neraca.adaJurnal[i]) ? (
                  <p className="mt-4 rounded-md border border-destructive/50 p-3 text-sm text-destructive">{tr("balanceSheet.unbalancedNote")}</p>
                ) : null}
              </>
            )
          ) : null}
          <CatatanCakupan />
        </CardContent>
      </Card>
    </div>
  );
}
