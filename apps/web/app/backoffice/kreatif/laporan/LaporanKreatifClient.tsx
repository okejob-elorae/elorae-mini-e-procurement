"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, Copy, Download, FileText, Loader2, Printer, Search, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eksporPerformaAction } from "@/app/actions/kreatif-laporan";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { LABEL_PLATFORM } from "@/lib/creative/aturan";
import { ringkasAngka } from "../kol/format-kol";
import {
  alamatCetakRekap,
  alamatLaporan,
  namaBerkasRekap,
  PERIODE_BAWAAN,
  URUT_PERINGKAT,
  type ParamLaporan,
  type TabLaporan,
  type UrutPeringkat,
} from "@/lib/creative/laporan-param";
import { PILIHAN_PERIODE, periodeDari, type PilihanPeriode } from "@/lib/creative/laporan-periode";
import type { HasilPeringkat } from "@/lib/creative/laporan-queries";
import { labelRentang, rentangCepat, type Rentang } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";

type Props = {
  param: ParamLaporan & { urut: UrutPeringkat };
  hariIni: string;
  peringkat?: HasilPeringkat;
  rekap?: { teks: string; rentang: Rentang };
};

function unduh(isi: string, namaBerkas: string, jenis: string) {
  const url = URL.createObjectURL(new Blob([isi], { type: jenis }));
  const a = document.createElement("a");
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Laporan Ruang KOL. Semua keadaan di alamat (`router.replace`); berganti tab
 * mengembalikan periode ke bawaan tab itu (Peringkat: bulan ini, Rekap: hari
 * ini).
 */
export function LaporanKreatifClient({ param, hariIni, peringkat, rekap }: Props) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();

  const pergi = (ubah: Partial<ParamLaporan>) =>
    mulaiPindah(() => router.replace(alamatLaporan({ ...param, ...ubah }), { scroll: false }));

  const gantiTab = (tab: TabLaporan) => {
    const periode = PERIODE_BAWAAN[tab];
    pergi({ tab, periode, rentang: periodeDari({ pilihan: periode, hariIni }), halaman: 1 });
  };

  const gantiPeriode = (p: PilihanPeriode) => {
    const rentang = p === "rentang" ? (param.rentang ?? rentangCepat("tigaPuluhHari", hariIni)) : periodeDari({ pilihan: p, hariIni });
    pergi({ periode: p, rentang, halaman: 1 });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.laporan")}
        meta={param.rentang ? labelRentang(param.rentang.dari, param.rentang.sampai, locale) : t("laporan.periode.semua")}
      />

      <Tabs value={param.tab} onValueChange={(v) => gantiTab(v as TabLaporan)}>
        <TabsList aria-label={t("laporan.tab.label")}>
          <TabsTrigger value="peringkat">
            <Trophy className="h-4 w-4" aria-hidden />
            {t("laporan.tab.peringkat")}
          </TabsTrigger>
          <TabsTrigger value="rekap">
            <FileText className="h-4 w-4" aria-hidden />
            {t("laporan.tab.rekap")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div role="group" aria-label={t("laporan.periode.label")} className="flex flex-wrap gap-1.5">
          {PILIHAN_PERIODE.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={param.periode === p ? "secondary" : "outline"}
              aria-pressed={param.periode === p}
              className={cn(param.periode === p && "ring-1 ring-foreground/30")}
              onClick={() => gantiPeriode(p)}
            >
              {t(`laporan.periode.${p}`)}
            </Button>
          ))}
        </div>
        {param.periode === "rentang" && param.rentang ? (
          <RentangTanggalInput
            dari={param.rentang.dari}
            sampai={param.rentang.sampai}
            max={hariIni}
            required
            aria-label={t("laporan.periode.rentangAria")}
            className="w-full sm:w-72"
            onChange={(r) => {
              if (r.dari && r.sampai) pergi({ periode: "rentang", rentang: r, halaman: 1 });
            }}
          />
        ) : null}
      </div>

      <div className={cn(berpindah && "opacity-60 transition-opacity")}>
        {param.tab === "peringkat" && peringkat ? (
          <TabPeringkat param={param} data={peringkat} pergi={pergi} />
        ) : rekap ? (
          <TabRekap teks={rekap.teks} rentang={rekap.rentang} />
        ) : null}
      </div>
    </div>
  );
}

function TabPeringkat({
  param,
  data,
  pergi,
}: {
  param: Props["param"];
  data: HasilPeringkat;
  pergi: (ubah: Partial<ParamLaporan>) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [mengekspor, mulaiEkspor] = useTransition();
  const [cari, setCari] = useState(param.cari);
  const cariTerakhir = useRef(param.cari);

  useEffect(() => {
    if (cari === cariTerakhir.current) return;
    const h = window.setTimeout(() => {
      cariTerakhir.current = cari;
      router.replace(alamatLaporan({ ...param, cari, halaman: 1 }), { scroll: false });
    }, 350);
    return () => window.clearTimeout(h);
  }, [cari, param, router]);

  const angkaDesimal = new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ekspor = () =>
    mulaiEkspor(async () => {
      const r = await eksporPerformaAction({
        periode: param.periode,
        dari: param.rentang?.dari ?? null,
        sampai: param.rentang?.sampai ?? null,
        cari: param.cari,
      });
      if (!r.ok) {
        toast.error(t("laporan.peringkat.eksporGagal"));
        return;
      }
      unduh(r.isi, r.namaBerkas, "text/csv;charset=utf-8");
      toast.success(t("laporan.peringkat.eksporOk"));
    });

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" aria-hidden />
              {t("laporan.peringkat.judul")}
            </CardTitle>
            <p className="text-sm text-muted-foreground tabular-nums">
              {param.rentang ? t("laporan.peringkat.meta", { n: data.total }) : t("laporan.peringkat.metaSemua", { n: data.total })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={ekspor} disabled={mengekspor}>
            {mengekspor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t("laporan.peringkat.ekspor")}
          </Button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t("laporan.peringkat.cari")}
              aria-label={t("laporan.peringkat.cari")}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("laporan.peringkat.urut")}</span>
            <Select value={param.urut} onValueChange={(v) => pergi({ urut: v, halaman: 1 })}>
              <SelectTrigger className="w-48" aria-label={t("laporan.peringkat.urut")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {URUT_PERINGKAT.map((u) => (
                  <SelectItem key={u} value={u}>
                    {t(`laporan.urut.${u}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.baris.length === 0 ? (
          param.cari ? (
            <EmptyState icon={Search} title={t("laporan.peringkat.kosongCariJudul")} description={t("laporan.peringkat.kosongCariIsi")} />
          ) : (
            <EmptyState
              icon={Trophy}
              title={t("laporan.peringkat.kosongJudul")}
              description={param.periode !== "semua" ? t("laporan.peringkat.kosongIsi") : undefined}
              action={
                param.periode !== "semua" ? (
                  <Button variant="outline" onClick={() => pergi({ periode: "semua", rentang: null, halaman: 1 })}>
                    {t("laporan.peringkat.kosongSemua")}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-right">{t("laporan.kolom.no")}</TableHead>
                    <TableHead className="min-w-[150px]">{t("laporan.kolom.kol")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("laporan.kolom.platform")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.konten")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.views")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.orders")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.gmv")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.biaya")}</TableHead>
                    <TableHead className="text-right">{t("laporan.kolom.roas")}</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">{t("laporan.kolom.cpm")}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{t("laporan.kolom.aksi")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="baris-berurutan">
                  {data.baris.map((b) => {
                    const atas = b.peringkat <= 3;
                    // Pengikut ditulis ringkas ("85 rb"), sama dengan daftar KOL.
                    const platform = b.platform ? `${LABEL_PLATFORM[b.platform]} · ${ringkasAngka(b.pengikut)}` : "—";
                    return (
                      <TableRow key={b.kolId} className={cn(atas && "bg-primary/5")}>
                        <TableCell className={cn("text-right tabular-nums", atas ? "text-base font-bold text-tautan" : "text-muted-foreground")}>
                          {b.peringkat}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <p className="font-medium">{b.handle ? `@${b.handle}` : b.nama}</p>
                          <p className="text-xs text-muted-foreground">
                            {[b.handle ? b.nama : null, b.niche].filter(Boolean).join(" · ") || "—"}
                            <span className="2xl:hidden">{b.platform ? ` · ${platform}` : ""}</span>
                          </p>
                        </TableCell>
                        <TableCell className="hidden text-sm tabular-nums 2xl:table-cell">{platform}</TableCell>
                        <TableCell className="text-right tabular-nums">{angkaTitik(b.jumlahKonten)}</TableCell>
                        <TableCell className="text-right tabular-nums">{angkaTitik(b.views)}</TableCell>
                        <TableCell className="text-right tabular-nums">{angkaTitik(b.orders)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{rupiahTeks(b.gmv)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rupiahTeks(b.biaya)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            b.roas !== null && b.roas >= 1 && "text-emerald-700 dark:text-emerald-400",
                            b.roas !== null && b.roas > 0 && b.roas < 1 && "text-red-700 dark:text-red-400",
                          )}
                        >
                          {b.roas === null ? "—" : `${angkaDesimal.format(b.roas)}×`}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums xl:table-cell">{b.cpm === null ? "—" : rupiahTeks(b.cpm)}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/backoffice/kreatif/kol/${b.kolId}`} aria-label={t("laporan.peringkat.bukaAria", { nama: b.nama })}>
                              {t("laporan.peringkat.buka")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={param.halaman}
              totalPages={Math.max(1, Math.ceil(data.total / data.perHalaman))}
              onPageChange={(halaman) => pergi({ halaman })}
              totalCount={data.total}
              pageSize={data.perHalaman}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TabRekap({ teks, rentang }: { teks: string; rentang: Rentang }) {
  const t = useTranslations("kreatifRuang");

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(t("laporan.rekap.disalin"));
    } catch {
      toast.error(t("laporan.rekap.salinGagal"));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" aria-hidden />
          {t("laporan.rekap.judul")}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={salin}>
            <Copy className="h-4 w-4" aria-hidden />
            {t("laporan.rekap.salin")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => unduh(teks, namaBerkasRekap(rentang), "text/plain;charset=utf-8")}>
            <Download className="h-4 w-4" aria-hidden />
            {t("laporan.rekap.unduh")}
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={alamatCetakRekap(rentang)} target="_blank" rel="noopener">
              <Printer className="h-4 w-4" aria-hidden />
              {t("laporan.rekap.cetak")}
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed">
          {teks}
        </pre>
      </CardContent>
    </Card>
  );
}
