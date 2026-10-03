"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Loader2, LogIn, LogOut, MapPin } from "lucide-react";
import { absenMasukAction, absenPulangAction } from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { unggahFoto } from "@/lib/foto/unggah";
import { dinamis } from "@/lib/i18n/dinamis";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import type { DataKartuAbsen } from "@/lib/salesman/absensi";
import { cn } from "@/lib/utils";
import { AmbilSwafoto } from "../absen/AmbilSwafoto";
import { IkonJenisIzin, nadaJenisIzin } from "../absen/tampilan-izin";

type Tahap = "lokasi" | "unggah" | "simpan";

class GalatLokasi extends Error {
  constructor(readonly kode: "lokasiDitolak" | "lokasiGagal") {
    super(kode);
  }
}

/** Posisi sekarang; ditolak/gagal/lewat waktu → `GalatLokasi`. */
function ambilLokasi(batasMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GalatLokasi("lokasiGagal"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (e) => reject(new GalatLokasi(e.code === e.PERMISSION_DENIED ? "lokasiDitolak" : "lokasiGagal")),
      { enableHighAccuracy: true, timeout: batasMs, maximumAge: 30_000 },
    );
  });
}

/**
 * Kartu absen hari ini di beranda salesman (juga di atas halaman /pwa/absen).
 *
 * Absen masuk = swafoto kamera depan + lokasi GPS, keduanya diambil saat itu
 * juga; jam dicatat server. Absen pulang meminta konfirmasi dulu — ketukan
 * nyasar pukul sepuluh pagi akan menutup hari kerjanya dan tidak bisa dibuka
 * lagi dari HP. Lokasi pulang dicoba tapi tidak wajib.
 *
 * Hanya daring: absen yang disimpan di HP bisa diberi jam HP, dan jam HP bisa
 * diputar — seluruh gunanya absen hilang.
 *
 * Hari yang izin/sakit/cutinya DISETUJUI kantor: kartu menyebutnya dan tidak
 * meminta absen masuk. Kalau ia tetap absen masuk (izin setengah hari, atau
 * ternyata masuk), absennya tercatat seperti biasa dan hari itu dihitung hadir.
 */
export function KartuAbsen({ data, tampilkanRiwayat = true }: { data: DataKartuAbsen; tampilkanRiwayat?: boolean }) {
  const t = useTranslations("pwa.absen");
  const td = dinamis(t);
  const tFoto = useTranslations("foto");
  const router = useRouter();
  const [kamera, setKamera] = useState(false);
  const [tahap, setTahap] = useState<Tahap | null>(null);
  const [konfirmasiPulang, setKonfirmasiPulang] = useState(false);
  const [pending, mulai] = useTransition();
  const sibuk = tahap !== null || pending;

  const durasi = (menit: number) => t("durasi", { jam: Math.floor(menit / 60), menit: menit % 60 });

  const masuk = async (blob: Blob | null, catatan: string) => {
    if (!navigator.onLine) {
      toast.error(t("luring"));
      return;
    }
    try {
      setTahap("lokasi");
      const pos = await ambilLokasi(15_000);
      let selfieUrl: string | null = null;
      if (blob) {
        setTahap("unggah");
        try {
          selfieUrl = await unggahFoto(new File([blob], "swafoto.jpg", { type: blob.type || "image/jpeg" }));
        } catch (err) {
          // Foto yang DITOLAK server (terlalu besar, bukan gambar) — sebutkan
          // sebabnya; selebihnya sinyal putus di tengah unggah.
          toast.error(
            nasibUnggah(err) === "terminal" ? tFoto(`err${err instanceof Error ? err.message : "GAGAL"}` as never) : t("luring"),
          );
          return;
        }
      }
      setTahap("simpan");
      const r = await absenMasukAction({
        selfieUrl,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        akurasi: pos.coords.accuracy,
        catatan: catatan.trim() || null,
      });
      if (r.ok) {
        toast.success(t("masukBerhasil"));
        setKamera(false);
      } else {
        toast.error(td(`err.${r.kode}`));
        if (r.kode === "SUDAH_MASUK") setKamera(false);
      }
      mulai(() => router.refresh());
    } catch (err) {
      // Lokasi ditolak/gagal, atau aksi server tak terjangkau (sinyal).
      toast.error(err instanceof GalatLokasi ? t(err.kode) : t("luring"));
    } finally {
      setTahap(null);
    }
  };

  const pulang = async () => {
    setKonfirmasiPulang(false);
    if (!navigator.onLine) {
      toast.error(t("luring"));
      return;
    }
    try {
      setTahap("lokasi");
      // Lokasi pulang hanya keterangan: gagal mendapatkannya tidak menahan jam pulang.
      const pos = await ambilLokasi(8_000).catch(() => null);
      setTahap("simpan");
      const r = await absenPulangAction({ lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null });
      if (r.ok) toast.success(t("pulangBerhasil"));
      else toast.error(td(`err.${r.kode}`));
      mulai(() => router.refresh());
    } catch {
      toast.error(t("luring"));
    } finally {
      setTahap(null);
    }
  };

  const labelTahap = tahap ? t(`tahap.${tahap}`) : null;

  return (
    <section className="beranda-kartu space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul">{t("kartuJudul")}</h2>
        {tampilkanRiwayat ? (
          <Link
            href="/pwa/absen"
            className="-my-2 inline-flex min-h-11 items-center text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
          >
            {t("riwayat")}
          </Link>
        ) : null}
      </div>

      {data.masuk ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <LogIn className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("masukJam", { jam: data.masuk.jam })}
          </span>
          {data.pulang ? (
            <span className="inline-flex items-center gap-1.5">
              <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t("pulangJam", { jam: data.pulang.jam })}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              data.masuk.menitTerlambat > 0
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
            )}
          >
            {data.masuk.menitTerlambat > 0 ? t("terlambat", { menit: data.masuk.menitTerlambat }) : t("tepatWaktu")}
          </span>
          {data.lamaKerja !== null ? (
            <span className="text-muted-foreground">{t("lamaKerja", { durasi: durasi(data.lamaKerja) })}</span>
          ) : null}
        </div>
      ) : data.izinHariIni ? (
        <p className="flex items-center gap-2 text-sm">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", nadaJenisIzin(data.izinHariIni))}>
            <IkonJenisIzin jenis={data.izinHariIni} className="h-4 w-4" />
          </span>
          {td(`izinHariIni.${data.izinHariIni}`)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("belumMasuk", { jam: data.jamMasukPaling })}</p>
      )}

      {!data.masuk && data.aktif && !data.izinHariIni ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" onClick={() => setKamera(true)} disabled={sibuk}>
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Camera className="mr-2 h-4 w-4" aria-hidden />}
            {labelTahap ?? t("absenMasuk")}
          </Button>
          {!data.selfieWajib ? (
            <Button variant="outline" className="w-full" onClick={() => void masuk(null, "")} disabled={sibuk}>
              <MapPin className="mr-2 h-4 w-4" aria-hidden />
              {t("masukTanpaSwafoto")}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("masukPetunjuk")}</p>
        </div>
      ) : null}

      {!data.masuk && data.aktif && data.izinHariIni ? (
        // Izin setengah hari, atau ternyata masuk: absennya tetap bisa dicatat, tapi tidak didesak.
        <Button variant="outline" className="w-full" onClick={() => setKamera(true)} disabled={sibuk}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Camera className="mr-2 h-4 w-4" aria-hidden />}
          {labelTahap ?? t("tetapMasuk")}
        </Button>
      ) : null}

      {data.masuk && !data.pulang ? (
        <Button variant="outline" size="lg" className="w-full" onClick={() => setKonfirmasiPulang(true)} disabled={sibuk}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="mr-2 h-4 w-4" aria-hidden />}
          {labelTahap ?? t("absenPulang")}
        </Button>
      ) : null}

      {kamera ? (
        <AmbilSwafoto sibuk={sibuk} onPakai={(blob, catatan) => void masuk(blob, catatan)} onTutup={() => setKamera(false)} />
      ) : null}

      <AlertDialog open={konfirmasiPulang} onOpenChange={setKonfirmasiPulang}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiPulangJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("konfirmasiPulangIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void pulang()}>{t("absenPulang")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
