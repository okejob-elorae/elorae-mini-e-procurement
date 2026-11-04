"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarCheck, Check, Loader2, RotateCcw, Undo2 } from "lucide-react";
import {
  bukaLagiJadwalBulanAction,
  setujuiJadwalBulanAction,
  tolakJadwalBulanAction,
  type HasilJadwalBulanAksi,
} from "@/app/actions/spg-komisi-jadwal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { MAKS_ALASAN_JADWAL, type StatusJadwalBulan } from "@/lib/spg/jadwal-bulan";
import type { BarisJadwalBulanKantor } from "@/lib/spg/jadwal-bulan-queries";

/** Keadaan jadwal bulanan seorang SPG untuk satu bulan yang disentuh minggu di kisi. */
export type LencanaBulan = { bulan: string; label: string; status: StatusJadwalBulan };

/** Nada keadaan jadwal bulanan: draf abu-abu, menunggu kuning, disetujui hijau, dikembalikan merah. */
export const NADA_JADWAL_BULAN: Record<StatusJadwalBulan, StatusTone> = {
  DRAF: "inactive",
  DIAJUKAN: "waiting",
  DISETUJUI: "settled",
  DITOLAK: "attention",
};

type Keputusan = "SETUJUI" | "TOLAK" | "BUKA_LAGI";

/** Kode galat yang punya kalimatnya sendiri; kode lain jatuh ke "GAGAL". */
const GALAT_DIKENAL = new Set([
  "TANPA_AKSES",
  "INPUT_TIDAK_SAH",
  "BULAN_TIDAK_SAH",
  "JADWAL_BERUBAH",
  "STATUS_BERUBAH",
  "ALASAN_WAJIB",
  "ALASAN_TERLALU_PANJANG",
  "SUDAH_DIBAYAR",
  "PEMOHON_SAMA",
]);

/** Paling banyak sekian tanggal ditulis di satu sel; sisanya diringkas "+N lagi". */
const MAKS_TANGGAL = 5;

/**
 * Tab "Jadwal bulanan" kantor (P7c): jadwal kerja yang diisi SPG di HP — dasar gaji pokoknya
 * (P7a) — disetujui, dikembalikan dengan alasan, atau dibuka lagi. Setiap keputusan mengirim
 * versi jadwal yang dilihat di layar; jadwal yang berubah sementara itu ditolak penulisnya
 * (`JADWAL_BERUBAH`) dan halaman dimuat ulang. Tombolnya hanya untuk `spg_schedules:approve`.
 */
export function JadwalBulananKantor({ baris, bolehSetujui }: { baris: BarisJadwalBulanKantor[]; bolehSetujui: boolean }) {
  const t = useTranslations("jadwalSpg.bulanan");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState<{ baris: BarisJadwalBulanKantor; keputusan: Keputusan } | null>(null);
  const [alasan, setAlasan] = useState("");

  const tanggal = (day: string) => formatDisplayDate(new Date(`${day}T00:00:00+07:00`), locale);
  const daftar = (hari: string[]) =>
    hari.length <= MAKS_TANGGAL
      ? hari.map(tanggal).join(", ")
      : `${hari.slice(0, MAKS_TANGGAL).map(tanggal).join(", ")} ${t("lainnya", { count: hari.length - MAKS_TANGGAL })}`;

  const butuhAlasan = buka !== null && buka.keputusan !== "SETUJUI";
  const alasanRapi = alasan.trim();
  const alasanKurang = butuhAlasan && alasanRapi.length === 0;
  const alasanLebih = butuhAlasan && alasanRapi.length > MAKS_ALASAN_JADWAL;

  const putuskan = () => {
    if (!buka) return;
    const { baris: b, keputusan } = buka;
    mulai(async () => {
      const isian = { userId: b.userId, bulan: b.bulan, versi: b.versi };
      let r: HasilJadwalBulanAksi;
      try {
        r =
          keputusan === "SETUJUI"
            ? await setujuiJadwalBulanAction(isian)
            : keputusan === "TOLAK"
              ? await tolakJadwalBulanAction({ ...isian, alasan: alasanRapi })
              : await bukaLagiJadwalBulanAction({ ...isian, alasan: alasanRapi });
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (!r.ok) {
        toast.error(td(`err.${GALAT_DIKENAL.has(r.code) ? r.code : "GAGAL"}`));
        // Jadwal berubah sejak halaman dimuat: tampilkan versinya yang sekarang.
        if (r.code === "JADWAL_BERUBAH" || r.code === "STATUS_BERUBAH") router.refresh();
        return;
      }
      toast.success(td(`ok.${keputusan}`, { nama: b.nama, bulan: b.label }));
      setBuka(null);
      setAlasan("");
      router.refresh();
    });
  };

  const tombol = (b: BarisJadwalBulanKantor) => {
    if (!bolehSetujui) return null;
    if (b.status === "DRAF" || b.status === "DIAJUKAN") {
      return (
        <span className="inline-flex flex-wrap justify-end gap-2">
          <Button size="sm" disabled={sibuk} onClick={() => setBuka({ baris: b, keputusan: "SETUJUI" })}>
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("setujui")}
          </Button>
          <Button size="sm" variant="outline" disabled={sibuk} onClick={() => setBuka({ baris: b, keputusan: "TOLAK" })}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("tolak")}
          </Button>
        </span>
      );
    }
    if (b.status === "DISETUJUI") {
      return (
        <span className="inline-flex flex-col items-end gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={sibuk || b.sudahDibayar}
            onClick={() => setBuka({ baris: b, keputusan: "BUKA_LAGI" })}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("bukaLagi")}
          </Button>
          {b.sudahDibayar ? <span className="text-xs text-muted-foreground">{t("sudahDibayar")}</span> : null}
        </span>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("isi")}</CardDescription>
      </CardHeader>
      <CardContent className={baris.length === 0 ? "p-0" : "px-0"}>
        {baris.length === 0 ? (
          <EmptyState icon={CalendarCheck} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <>
            {!bolehSetujui ? <p className="px-6 pb-3 text-sm text-muted-foreground">{t("hanyaLihat")}</p> : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.spg")}</TableHead>
                    <TableHead>{t("kolom.bulan")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead className="text-right">{t("kolom.hariKerja")}</TableHead>
                    <TableHead>{t("kolom.perhatian")}</TableHead>
                    <TableHead className="text-right">{t("kolom.tindakan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={`${b.userId}-${b.bulan}`}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.nama}</p>
                        <p className="text-xs text-muted-foreground">{b.namaToko}</p>
                      </TableCell>
                      <TableCell>{b.label}</TableCell>
                      <TableCell>
                        <StatusPill tone={NADA_JADWAL_BULAN[b.status]} detail={t("versi", { n: b.versi })}>
                          {td(`status.${b.status}`)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.hariKerja}</TableCell>
                      <TableCell className="min-w-[16rem] whitespace-normal text-xs">
                        {b.hariKosong.length > 0 ? (
                          <p className="text-amber-700 dark:text-amber-400">
                            {t("hariKosong", { count: b.hariKosong.length, daftar: daftar(b.hariKosong) })}
                          </p>
                        ) : null}
                        {b.liburDenganCheckin.length > 0 ? (
                          <p>{t("liburMasuk", { count: b.liburDenganCheckin.length, daftar: daftar(b.liburDenganCheckin) })}</p>
                        ) : null}
                        {b.luarRadius.length > 0 ? (
                          <p className="text-muted-foreground">{t("luarRadius", { daftar: daftar(b.luarRadius) })}</p>
                        ) : null}
                        {b.berubahSejakDisetujui.length > 0 ? (
                          <p className="text-muted-foreground">{t("berubah", { daftar: daftar(b.berubahSejakDisetujui) })}</p>
                        ) : null}
                        {b.hariKosong.length === 0 &&
                        b.liburDenganCheckin.length === 0 &&
                        b.luarRadius.length === 0 &&
                        b.berubahSejakDisetujui.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{tombol(b)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog
        open={buka !== null}
        onOpenChange={(o) => {
          if (sibuk || o) return;
          setBuka(null);
          setAlasan("");
        }}
      >
        <DialogContent>
          {buka ? (
            <>
              <DialogHeader>
                <DialogTitle>{td(`judul${buka.keputusan}`, { nama: buka.baris.nama, bulan: buka.baris.label })}</DialogTitle>
                <DialogDescription>{td(`isi${buka.keputusan}`, { bulan: buka.baris.label })}</DialogDescription>
              </DialogHeader>
              {buka.keputusan === "SETUJUI" && buka.baris.hariKosong.length > 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t("setujuiKosong", { count: buka.baris.hariKosong.length })}
                </p>
              ) : null}
              {butuhAlasan ? (
                <div className="space-y-2">
                  <Label htmlFor="jadwal-bulan-alasan">{t("alasan")}</Label>
                  <Textarea
                    id="jadwal-bulan-alasan"
                    value={alasan}
                    maxLength={MAKS_ALASAN_JADWAL}
                    onChange={(e) => setAlasan(e.target.value)}
                    rows={3}
                  />
                </div>
              ) : null}
              <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                {alasanKurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{t("alasanKurang")}</p> : null}
                {alasanLebih ? (
                  <p className="text-xs text-destructive sm:mr-auto">{t("err.ALASAN_TERLALU_PANJANG")}</p>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={sibuk}
                  onClick={() => {
                    setBuka(null);
                    setAlasan("");
                  }}
                >
                  {t("batal")}
                </Button>
                <Button onClick={putuskan} disabled={sibuk || alasanKurang || alasanLebih}>
                  {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {td(`tombol${buka.keputusan}`)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
