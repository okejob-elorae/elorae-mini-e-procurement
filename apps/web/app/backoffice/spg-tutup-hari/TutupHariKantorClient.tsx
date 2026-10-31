"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupiah } from "@/lib/format/rupiah";
import { geserHari } from "@/lib/tanggal-isian";
import { adaSelisih, konversiPersen, MAKS_HARI_REKAP } from "@/lib/spg/tutup-hari";
import type { BarisKantorHari, DaftarTutupHariKantor, RekapTutupHariKantor } from "@/lib/spg/tutup-hari-queries";
import { cn } from "@/lib/utils";
import { pengunjungDipakai } from "./pengunjung";

type Props =
  | { mode: "hari"; hariIni: string; data: DaftarTutupHariKantor; penghitung: Record<string, number | null>; label: string }
  | {
      mode: "rentang";
      hariIni: string;
      rekap: RekapTutupHariKantor;
      pengunjung: Record<string, { angka: number | null; adaDariLaporan: boolean }>;
      label: string;
    };

const ALAMAT = "/backoffice/spg-tutup-hari";

const persen = (n: number | null) => (n === null ? "—" : `${String(n).replace(".", ",")}%`);
const selisihTeks = (n: number) => `${n > 0 ? "+" : ""}${formatRupiah(n)}`;

/**
 * Tutup hari SPG di kantor. Per hari: semua toko yang punya SPG, yang belum
 * tutup padahal sudah berjualan di atas (disorot). Rentang: rekap per toko.
 * Tanggal di alamat, berpindah dengan `replace` — kedua tanggal rentang
 * ditulis dalam SATU navigasi.
 */
export function TutupHariKantorClient(props: Props) {
  const t = useTranslations("spgTutupHari.kantor");
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const pindah = (qs: string) => mulai(() => router.replace(qs ? `${ALAMAT}?${qs}` : ALAMAT, { scroll: false }));

  const keHari = () => pindah(props.mode === "hari" ? `hari=${props.data.day}` : `hari=${props.rekap.sampai}`);
  const keRentang = () => {
    const sampai = props.mode === "hari" ? props.data.day : props.rekap.sampai;
    pindah(`dari=${geserHari(sampai, -6)}&sampai=${sampai}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={
          props.mode === "hari"
            ? t("ringkasHari", { tanggal: props.label, sudah: props.data.sudah, belum: props.data.belum, kejar: props.data.belumAdaNota })
            : t("ringkasRentang", { rentang: props.label, hari: props.rekap.hari, toko: props.rekap.baris.length })
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Tabs value={props.mode} onValueChange={(v) => (v === "hari" ? keHari() : keRentang())}>
          <TabsList aria-label={t("mode")}>
            <TabsTrigger value="hari" disabled={menunggu}>
              {t("modeHari")}
            </TabsTrigger>
            <TabsTrigger value="rentang" disabled={menunggu}>
              {t("modeRentang")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {props.mode === "hari" ? (
          <TanggalInput
            className="w-full sm:w-56"
            value={props.data.day}
            max={props.hariIni}
            required
            aria-label={t("tanggal")}
            onChange={(e) => {
              if (e.target.value) pindah(`hari=${e.target.value}`);
            }}
          />
        ) : (
          <RentangTanggalInput
            className="w-full sm:w-80"
            dari={props.rekap.dari}
            sampai={props.rekap.sampai}
            max={props.hariIni}
            maksHari={MAKS_HARI_REKAP}
            required
            aria-label={t("rentang")}
            onChange={(r) => {
              if (r.dari && r.sampai) pindah(`dari=${r.dari}&sampai=${r.sampai}`);
            }}
          />
        )}
      </div>

      <div className={cn("transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {props.mode === "hari" ? (
          <TabelHari data={props.data} penghitung={props.penghitung} />
        ) : (
          <TabelRekap rekap={props.rekap} pengunjung={props.pengunjung} />
        )}
      </div>
    </div>
  );
}

function TabelHari({ data, penghitung }: { data: DaftarTutupHariKantor; penghitung: Record<string, number | null> }) {
  const t = useTranslations("spgTutupHari.kantor");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          {t("daftarJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
        {data.baris.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.toko")}</TableHead>
                  <TableHead>{t("kolom.status")}</TableHead>
                  <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                  <TableHead className="text-right">{t("kolom.bersih")}</TableHead>
                  <TableHead className="text-right">{t("kolom.pengunjung")}</TableHead>
                  <TableHead className="text-right">{t("kolom.kasir")}</TableHead>
                  <TableHead>{t("kolom.catatan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.baris.map((b) => (
                  <BarisHari key={b.storeId} b={b} penghitung={penghitung[b.storeId] ?? null} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BarisHari({ b, penghitung }: { b: BarisKantorHari; penghitung: number | null }) {
  const t = useTranslations("spgTutupHari.kantor");
  const l = b.laporan;
  const kejar = !l && b.sistem.nota > 0;
  const tamu = pengunjungDipakai(penghitung, l?.pengunjung ?? null);
  const konversi = konversiPersen(l ? l.nota : b.sistem.nota, tamu.angka);
  return (
    <TableRow className={cn(kejar && "bg-amber-500/[0.06]")}>
      <TableCell className="min-w-[10rem] whitespace-normal">
        <span className="block font-medium">{b.toko}</span>
        <span className="block text-xs text-muted-foreground">
          {b.kode}
          {b.spg.length > 0 ? ` · ${b.spg.join(", ")}` : ""}
        </span>
      </TableCell>
      <TableCell className="min-w-[9rem] whitespace-normal">
        {l ? (
          <span className="space-y-0.5">
            <Link href={`${ALAMAT}/${l.id}`} className="block font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
              {t("sudah")}
            </Link>
            <span className="block text-xs text-muted-foreground">{t("olehJam", { nama: l.oleh, jam: l.jam })}</span>
            {b.berubah ? (
              <span className="mt-1 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                {t("berubah")}
              </span>
            ) : null}
          </span>
        ) : (
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
              kejar ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
            )}
          >
            {kejar ? t("belum") : t("tanpaJual")}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className="block">{l ? l.nota : b.sistem.nota}</span>
        <span className="block text-xs text-muted-foreground">{t("pcs", { n: l ? l.potong : b.sistem.potong })}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatRupiah(l ? l.nilaiBersih : b.sistem.nilaiBersih)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <span className="block">{tamu.angka ?? "—"}</span>
        {tamu.sumber === "LAPORAN" ? <span className="block text-xs text-muted-foreground">{t("pengunjungDariLaporan")}</span> : null}
        {tamu.laporanBeda !== null ? (
          <span className="block text-xs text-muted-foreground">{t("pengunjungLaporan", { n: tamu.laporanBeda })}</span>
        ) : null}
        {konversi !== null ? <span className="block text-xs text-muted-foreground">{t("konversi", { n: persen(konversi) })}</span> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className="block">{l?.kasir != null ? formatRupiah(l.kasir) : "—"}</span>
        {l && l.selisih !== null ? (
          <span className={cn("block text-xs", l.adaSelisih ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {l.adaSelisih ? t("selisih", { nilai: selisihTeks(l.selisih) }) : t("sesuai")}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="min-w-[11rem] max-w-[20rem] whitespace-normal">
        {l?.catatan ? <span className="line-clamp-3 text-sm">{l.catatan}</span> : <span className="text-muted-foreground">—</span>}
        {l && l.foto.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {l.foto.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={t("bukaFoto", { n: i + 1 })} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-10 w-10 rounded border object-cover" loading="lazy" />
              </a>
            ))}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function TabelRekap({
  rekap,
  pengunjung,
}: {
  rekap: RekapTutupHariKantor;
  pengunjung: Record<string, { angka: number | null; adaDariLaporan: boolean }>;
}) {
  const t = useTranslations("spgTutupHari.kantor");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          {t("rekapJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className={rekap.baris.length === 0 ? undefined : "px-0"}>
        {rekap.baris.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.toko")}</TableHead>
                  <TableHead className="text-right">{t("kolom.hariTutup")}</TableHead>
                  <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                  <TableHead className="text-right">{t("kolom.bersih")}</TableHead>
                  <TableHead className="text-right">{t("kolom.pengunjung")}</TableHead>
                  <TableHead className="text-right">{t("kolom.kasir")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rekap.baris.map((b) => {
                  const bolong = b.hariTutup < b.hariJual;
                  return (
                    <TableRow key={b.storeId}>
                      <TableCell className="min-w-[12rem] whitespace-normal">
                        <span className="block font-medium">{b.toko}</span>
                        <span className="block text-xs text-muted-foreground">{b.kode}</span>
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", bolong && "font-medium text-amber-700 dark:text-amber-300")}>
                        {t("hariTutupDari", { tutup: b.hariTutup, jual: b.hariJual })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="block">{b.nota}</span>
                        <span className="block text-xs text-muted-foreground">{t("pcs", { n: b.potong })}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.nilaiBersih)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="block">{pengunjung[b.storeId]?.angka ?? "—"}</span>
                        {pengunjung[b.storeId]?.adaDariLaporan ? (
                          <span className="block text-xs text-muted-foreground">{t("pengunjungSebagianLaporan")}</span>
                        ) : null}
                        {b.pengunjung !== null && b.pengunjung !== (pengunjung[b.storeId]?.angka ?? null) ? (
                          <span className="block text-xs text-muted-foreground">{t("pengunjungLaporan", { n: b.pengunjung })}</span>
                        ) : null}
                        {b.konversi !== null ? (
                          <span className="block text-xs text-muted-foreground">{t("konversiLaporan", { n: persen(b.konversi) })}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="block">{b.kasir !== null ? formatRupiah(b.kasir) : "—"}</span>
                        {b.selisih !== null ? (
                          <span className={cn("block text-xs", adaSelisih(b.selisih) ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                            {adaSelisih(b.selisih) ? t("selisihHari", { nilai: selisihTeks(b.selisih), hari: b.hariSelisih }) : t("sesuai")}
                          </span>
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
  );
}

