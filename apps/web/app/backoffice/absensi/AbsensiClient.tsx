"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarCheck, CalendarOff, ChevronLeft, ChevronRight, Download, Loader2, MapPin, Users } from "lucide-react";
import { eksporAbsensiExcelAction, type LabelEksporAbsensi } from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import type { PengaturanAbsensi } from "@/lib/salesman/absensi";
import type { BarisAbsenKantor, RekapOrangBulan } from "@/lib/salesman/absensi-queries";
import { JENIS_IZIN } from "@/lib/salesman/izin";
import { cn } from "@/lib/utils";
import { IkonJenisIzin, nadaJenisIzin } from "@/app/pwa/absen/tampilan-izin";
import { unduhExcel } from "../biaya-perjalanan/unduh";
import { TanggalInput } from "@/components/ui/tanggal-input";

type Umum = {
  tanggal: string;
  hariIni: string;
  bulan: string;
  pilihanBulan: { kunci: string; label: string }[];
  pengaturan: PengaturanAbsensi;
};

type Props =
  | (Umum & {
      tampilan: "hari";
      labelTanggal: string;
      sebelum: string;
      sesudah: string | null;
      baris: BarisAbsenKantor[];
    })
  | (Umum & { tampilan: "bulan"; rekap: RekapOrangBulan[] });

const ALAMAT = "/backoffice/absensi";

/** "09:00" → "09.00" — gaya jam WIB yang sama dengan layar lain. */
const jamTitik = (jam: string) => jam.replace(":", ".");

export function AbsensiClient(props: Props) {
  const t = useTranslations("absensi");
  const router = useRouter();
  const [mengekspor, setMengekspor] = useState(false);
  const durasi = (menit: number) => t("durasi", { jam: Math.floor(menit / 60), menit: menit % 60 });

  const labelEkspor = (): LabelEksporAbsensi => ({
    judul: t("judul"),
    kolom: {
      tanggal: t("kolom.tanggal"),
      nama: t("kolom.nama"),
      masuk: t("kolom.masuk"),
      pulang: t("kolom.pulang"),
      terlambat: t("excel.terlambatMenit"),
      lamaKerja: t("excel.lamaKerjaMenit"),
      akurasi: t("excel.akurasi"),
      petaMasuk: t("excel.petaMasuk"),
      petaPulang: t("excel.petaPulang"),
      swafoto: t("kolom.swafoto"),
      catatan: t("kolom.catatan"),
    },
    rekap: t("excel.rekap"),
    kolomRekap: {
      nama: t("kolom.nama"),
      hadir: t("kolom.hadir"),
      terlambat: t("kolom.hariTerlambat"),
      menitTerlambat: t("kolom.menitTerlambat"),
      tanpaPulang: t("kolom.tanpaPulang"),
    },
    ada: t("excel.ada"),
  });

  const ekspor = async () => {
    setMengekspor(true);
    try {
      const r = await eksporAbsensiExcelAction({ bulan: props.bulan, label: labelEkspor() });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      unduhExcel(r.base64, r.filename);
      toast.success(t("eksporMulai"));
    } catch {
      toast.error(t("err.GAGAL"));
    } finally {
      setMengekspor(false);
    }
  };

  const keHari = (tanggal: string) => router.push(`${ALAMAT}?tampilan=hari&tanggal=${tanggal}`);
  const keBulan = (bulan: string) => router.push(`${ALAMAT}?tampilan=bulan&bulan=${bulan}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={props.pengaturan.aktif ? t("metaJamMasuk", { jam: jamTitik(props.pengaturan.jamMasukPaling) }) : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/backoffice/izin">
                <CalendarOff className="mr-2 h-4 w-4" />
                {t("bukaIzin")}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void ekspor()} disabled={mengekspor}>
              {mengekspor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {t("ekspor", { bulan: props.pilihanBulan.find((b) => b.kunci === props.bulan)?.label ?? props.bulan })}
            </Button>
          </div>
        }
      />

      {!props.pengaturan.aktif ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {t("nonaktif")}{" "}
          <Link href="/backoffice/settings/salesman#absensi" className="font-medium underline underline-offset-2">
            {t("bukaPengaturan")}
          </Link>
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div role="tablist" aria-label={t("tampilan")} className="inline-flex rounded-lg border p-1">
          <Button
            role="tab"
            aria-selected={props.tampilan === "hari"}
            variant={props.tampilan === "hari" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => keHari(props.tanggal)}
          >
            {t("perHari")}
          </Button>
          <Button
            role="tab"
            aria-selected={props.tampilan === "bulan"}
            variant={props.tampilan === "bulan" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => keBulan(props.bulan)}
          >
            {t("perBulan")}
          </Button>
        </div>

        {props.tampilan === "hari" ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => keHari(props.sebelum)} aria-label={t("hariSebelum")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <TanggalInput
              className="w-44"
              value={props.tanggal}
              max={props.hariIni}
              aria-label={t("pilihTanggal")}
              onChange={(e) => e.target.value && keHari(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => props.sesudah && keHari(props.sesudah)}
              disabled={!props.sesudah}
              aria-label={t("hariSesudah")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Select value={props.bulan} onValueChange={keBulan}>
            <SelectTrigger className="w-full sm:w-48" aria-label={t("pilihBulan")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.pilihanBulan.map((b) => (
                <SelectItem key={b.kunci} value={b.kunci}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {props.tampilan === "hari" ? (
        <TabelHari {...props} aktif={props.pengaturan.aktif} durasi={durasi} />
      ) : (
        <TabelBulan rekap={props.rekap} aktif={props.pengaturan.aktif} />
      )}
    </div>
  );
}

function TabelHari({
  labelTanggal,
  baris,
  aktif,
  durasi,
}: {
  labelTanggal: string;
  baris: BarisAbsenKantor[];
  /** Absensi sedang dimatikan di Pengaturan → Salesman: tidak ada yang bisa absen, jadi tidak ada yang "belum absen". */
  aktif: boolean;
  durasi: (menit: number) => string;
}) {
  const t = useTranslations("absensi");
  const td = dinamis(t);
  const hadir = baris.filter((b) => b.masuk).length;
  const terlambat = baris.filter((b) => b.menitTerlambat > 0).length;
  const izin = baris.filter((b) => !b.masuk && b.izin).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarCheck className="h-5 w-5" />
          {labelTanggal}
          <span className="text-sm font-normal text-muted-foreground">
            {aktif ? t("ringkasHari", { hadir, total: baris.length, terlambat }) : t("absensiMati")}
            {izin > 0 ? ` · ${t("ringkasIzin", { n: izin })}` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className={baris.length === 0 ? undefined : "px-0"}>
        {baris.length === 0 ? (
          <EmptyState icon={Users} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.nama")}</TableHead>
                  <TableHead>{t("kolom.masuk")}</TableHead>
                  <TableHead>{t("kolom.pulang")}</TableHead>
                  <TableHead>{t("kolom.status")}</TableHead>
                  <TableHead>{t("kolom.swafoto")}</TableHead>
                  <TableHead>{t("kolom.lokasi")}</TableHead>
                  <TableHead className="hidden 2xl:table-cell">{t("kolom.catatan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b) => (
                  <TableRow key={b.userId} className={cn(!b.masuk && !b.izin && "text-muted-foreground")}>
                    <TableCell className="min-w-[10rem] whitespace-normal font-medium">
                      {b.nama}
                      {b.catatan ? (
                        <span className="block text-xs font-normal text-muted-foreground 2xl:hidden">{b.catatan}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{b.masuk ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {b.pulang ?? "—"}
                      {b.lamaKerja !== null ? <span className="block text-xs text-muted-foreground">{durasi(b.lamaKerja)}</span> : null}
                    </TableCell>
                    <TableCell>
                      {!b.masuk && b.izin ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", nadaJenisIzin(b.izin))}>
                          <IkonJenisIzin jenis={b.izin} className="h-3.5 w-3.5" />
                          {td(`izin.${b.izin}`)}
                        </span>
                      ) : !b.masuk && !aktif ? (
                        <span className="text-xs" title={t("absensiMati")}>
                          —
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            !b.masuk
                              ? "bg-muted text-muted-foreground"
                              : b.menitTerlambat > 0
                                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                          )}
                        >
                          {!b.masuk
                            ? t("belumAbsen")
                            : b.menitTerlambat > 0
                              ? t("terlambat", { menit: b.menitTerlambat })
                              : t("tepatWaktu")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.selfieUrl ? (
                        <a href={b.selfieUrl} target="_blank" rel="noopener noreferrer" aria-label={t("lihatSwafoto", { nama: b.nama })}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={b.selfieUrl} alt="" loading="lazy" className="h-10 w-10 rounded-full border object-cover" />
                        </a>
                      ) : b.tanpaSwafoto ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                          {t("tanpaSwafoto")}
                        </span>
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                      {b.spg && b.masuk ? (
                        <span className="mt-1 block text-xs text-muted-foreground">{t("lewatCheckin")}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="flex flex-col gap-0.5 text-xs">
                        {b.petaMasuk ? (
                          <a href={b.petaMasuk} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            {b.akurasi !== null ? t("petaMasukAkurasi", { m: b.akurasi }) : t("petaMasuk")}
                          </a>
                        ) : null}
                        {b.petaPulang ? (
                          <a href={b.petaPulang} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            {t("petaPulang")}
                          </a>
                        ) : null}
                        {!b.petaMasuk && !b.petaPulang ? "—" : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[16rem] whitespace-normal text-sm 2xl:table-cell">{b.catatan ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TabelBulan({ rekap, aktif }: { rekap: RekapOrangBulan[]; aktif: boolean }) {
  const t = useTranslations("absensi");
  const td = dinamis(t);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t("rekapJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className={rekap.length === 0 ? undefined : "px-0"}>
        {rekap.length === 0 ? (
          <EmptyState icon={Users} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.nama")}</TableHead>
                  <TableHead className="text-right">{t("kolom.hadir")}</TableHead>
                  <TableHead className="text-right">{t("kolom.hariTerlambat")}</TableHead>
                  <TableHead className="text-right">{t("kolom.menitTerlambat")}</TableHead>
                  <TableHead className="text-right">{t("kolom.tanpaPulang")}</TableHead>
                  {JENIS_IZIN.map((j) => (
                    <TableHead key={j} className="text-right">
                      {td(`kolom.hari${j}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rekap.map((r) => (
                  <TableRow key={r.userId}>
                    <TableCell className="min-w-[10rem] whitespace-normal font-medium">{r.nama}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* Absensi mati: nol hari bukan berarti tidak hadir. */}
                      {r.hadir === 0 && !aktif ? <span className="text-muted-foreground">—</span> : r.hadir}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.terlambat > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>
                      {r.terlambat}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.menitTerlambat}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.tanpaPulang}</TableCell>
                    {JENIS_IZIN.map((j) => (
                      <TableCell key={j} className={cn("text-right tabular-nums", r.izin[j] === 0 && "text-muted-foreground")}>
                        {r.izin[j]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
