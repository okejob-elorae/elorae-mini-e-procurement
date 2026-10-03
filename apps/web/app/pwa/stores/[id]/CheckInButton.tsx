"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MapPinOff } from "lucide-react";
import { aturanKunjunganSaya, checkIn } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buangTitipan, titipKembali } from "@/lib/pwa/kembali-setelah-checkin";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { antreCheckin } from "@/lib/pwa/offline/luring-antrean";
import { lupakanKunjunganTerkirim, simpanAturanKunjungan } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { susunCheckin } from "@/lib/pwa/offline/luring-muatan";
import { KunjunganLuring } from "./KunjunganLuring";

type PermState = "prompt" | "granted" | "denied" | "unknown";
type Platform = "android" | "ios" | "lain";

type Props = {
  storeId: string;
  /** Nama toko ini — dibawa check-in tanpa sinyal supaya antrean dan beranda menyebut tokonya. */
  storeName?: string | null;
  autoCloseStoreName: string | null;
  /**
   * Layar yang dituju SESUDAH check-in (SPG yang datang dari "check-in dulu").
   * `checkIn` selalu mengalihkan ke halaman toko; tujuan ini dititipkan dan
   * halaman toko meneruskannya (`LanjutSetelahCheckIn`).
   */
  kembali?: string | null;
  /** Halaman toko: kunjungan yang check-in-nya masih di HP tetap bisa difoto. */
  fotoKunjungan?: boolean;
};

/** Akurasi di atas angka ini membuat pesan penolakan radius menyebut GPS yang kurang tepat. */
const AKURASI_PERLU_DISEBUT = 50;

/** Aturan check-out orang ini cukup ditanyakan sekali per sesi tab (`sessionStorage`). */
const KUNCI_ATURAN_DIMUAT = "elorae.pwa.aturanKunjungan.dimuat";

/**
 * Simpan aturan check-out orang ini di HP selagi ada sinyal, supaya check-out
 * TANPA sinyal nanti tahu apakah harus menanyakan alasan. Diam saja bila gagal.
 */
function muatAturanKunjungan() {
  if (tanpaSinyal()) return;
  try {
    if (window.sessionStorage.getItem(KUNCI_ATURAN_DIMUAT)) return;
  } catch {
    // Tanpa sessionStorage: tanyakan tetap, sekali per pemasangan tombol.
  }
  void aturanKunjunganSaya().then(
    (a) => {
      if (!a.ok) return;
      simpanAturanKunjungan({ spg: a.spg, alasanWajib: a.alasanWajib, fotoWajib: a.fotoWajib });
      try {
        window.sessionStorage.setItem(KUNCI_ATURAN_DIMUAT, "1");
      } catch {
        // Tidak apa-apa: ditanyakan lagi lain kali.
      }
    },
    () => undefined,
  );
}

function kenaliPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "lain";
}

export function CheckInButton({ storeId, storeName = null, autoCloseStoreName, kembali = null, fotoKunjungan = false }: Props) {
  const t = useTranslations("pwa.checkIn");
  const tl = useTranslations("pwaLuring.checkIn");
  // Check-in yang dicatat TANPA sinyal di toko ini (halaman ini mungkin dari
  // cache, jadi server-nya belum tahu). Begitu ia sampai, halaman dimuat ulang.
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  // Tanpa Permissions API (Safari lama) izin baru ketahuan dari galat GPS.
  // "unknown" dan "prompt" sama-sama menampilkan tombol biasa, jadi berbeda
  // dari render server tidak mengubah markup awal.
  const [perm, setPerm] = useState<PermState>(() =>
    typeof navigator !== "undefined" && !navigator.permissions ? "prompt" : "unknown",
  );
  // Hanya dipakai setelah izin terbaca "ditolak" (sesudah hidrasi), jadi
  // berbeda dari render server tidak mengubah markup awal.
  const [platform] = useState<Platform>(() => (typeof navigator === "undefined" ? "lain" : kenaliPlatform()));
  const [error, setError] = useState<string | null>(null);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = fetchingLocation || pending;
  const statusRef = useRef<PermissionStatus | null>(null);

  // Izin bisa diubah di pengaturan browser saat halaman ini di belakang, dan
  // tidak semua browser menembakkan `onchange` untuk itu — jadi izin dibaca
  // ulang setiap kali halaman kembali terlihat.
  const periksaIzin = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      (status) => {
        if (statusRef.current && statusRef.current !== status) statusRef.current.onchange = null;
        statusRef.current = status;
        setPerm(status.state as PermState);
        status.onchange = () => setPerm(status.state as PermState);
      },
      () => setPerm((p) => (p === "unknown" ? "prompt" : p)),
    );
  }, []);

  useEffect(() => {
    muatAturanKunjungan();
  }, []);

  useEffect(() => {
    periksaIzin();
    const saatTerlihat = () => {
      if (document.visibilityState === "visible") periksaIzin();
    };
    window.addEventListener("focus", periksaIzin);
    document.addEventListener("visibilitychange", saatTerlihat);
    return () => {
      window.removeEventListener("focus", periksaIzin);
      document.removeEventListener("visibilitychange", saatTerlihat);
      if (statusRef.current) statusRef.current.onchange = null;
    };
  }, [periksaIzin]);

  /**
   * Check-in ke antrean HP: tanpa sinyal, atau jawaban server tidak datang.
   * Waktunya waktu HP; server menilai radius, kunci toko, dan tanda janggal
   * dengan koordinat dan waktu ini saat terkirim. Mulai saat ini kunjungan
   * berjalan DI HP (`KunjunganLuring`).
   */
  async function antreLokal(clientId: string, pos: GeolocationPosition, waktu: number) {
    const baris = susunCheckin({
      clientId,
      storeId,
      storeName,
      waktu,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      akurasi: pos.coords.accuracy,
    });
    if (!baris) {
      setError(t("coordsError"));
      return;
    }
    try {
      await antreCheckin(baris);
    } catch {
      buangTitipan();
      setError(tl("gagalSimpan"));
      return;
    }
    // Halaman toko tidak dimuat ulang (tidak ada server) — titipan "kembali ke
    // layar tadi" diganti tombol Lanjutkan di kartu kunjungan.
    buangTitipan();
    toast.success(tl("tersimpanToast"));
  }

  function onTap() {
    setError(null);
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setFetchingLocation(false);
        setPerm("granted");
        // Satu id per ketukan: kalau jawaban server hilang di jalan, check-in
        // yang sama diantrekan dengan id ini dan dikenali server sebagai satu.
        const clientId = newLocalId();
        const waktu = Date.now();
        if (tanpaSinyal()) {
          void antreLokal(clientId, pos, waktu);
          return;
        }
        startTransition(async () => {
          if (kembali) titipKembali(storeId, kembali);
          let result: Awaited<ReturnType<typeof checkIn>>;
          try {
            result = await denganBatasWaktu(
              checkIn({
                storeId,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                clientId,
              }),
            );
          } catch (err) {
            // Berhasil = `checkIn` mengalihkan halaman (galat redirect milik
            // Next) — diteruskan ke router. Kunjungan di HP yang lama selesai.
            try {
              unstable_rethrow(err);
            } catch (alih) {
              lupakanKunjunganTerkirim();
              throw alih;
            }
            // Sinyal putus atau jawaban tidak datang: antrekan check-in yang sama.
            await antreLokal(clientId, pos, waktu);
            return;
          }
          if (result && !result.ok) {
            // Check-in ditolak: titipan tidak boleh menunggu kunjungan berikutnya.
            buangTitipan();
            if (result.code === "NOT_FOUND") setError(t("storeInactive"));
            else if (result.code === "STORE_NOT_ASSIGNED") setError(t("storeNotAssigned"));
            else if (result.code === "DI_LUAR_RADIUS") {
              const pesan = [t("diLuarRadius", { jarak: result.jarakMeter, radius: result.radiusMeter })];
              if (result.akurasiMeter !== null && result.akurasiMeter > AKURASI_PERLU_DISEBUT) {
                pesan.push(t("diLuarRadiusAkurasi", { akurasi: result.akurasiMeter }));
              }
              setError(pesan.join(" "));
            } else setError(t("coordsError"));
            return;
          }
        });
      },
      err => {
        setFetchingLocation(false);
        // Browser tanpa Permissions API hanya memberi tahu lewat galat ini.
        if (err.code === err.PERMISSION_DENIED) {
          setPerm("denied");
          setError(perm === "denied" ? t("izinMasihDitolak") : null);
          return;
        }
        setError(err.code === err.POSITION_UNAVAILABLE ? t("gpsMati") : t("coordsError"));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  // Kunjungan yang berjalan di HP menggantikan tombol check-in.
  if (lokal && lokal.keadaan !== "ditolak") {
    return <KunjunganLuring kunjungan={lokal} storeId={storeId} kembali={kembali} foto={fotoKunjungan} />;
  }
  // Check-in tanpa sinyal yang ditolak: alasannya di atas tombol check-in biasa.
  const ditolak = lokal ? <KunjunganLuring kunjungan={lokal} storeId={storeId} /> : null;

  if (perm === "denied") {
    const langkah: ("izinLangkahAndroid" | "izinLangkahIphone")[] =
      platform === "android"
        ? ["izinLangkahAndroid"]
        : platform === "ios"
          ? ["izinLangkahIphone"]
          : ["izinLangkahAndroid", "izinLangkahIphone"];
    return (
      <div className="space-y-2">
        {ditolak}
        <Alert variant="destructive">
          <MapPinOff className="h-4 w-4" />
          <AlertTitle>{t("izinDitolakJudul")}</AlertTitle>
          <AlertDescription>
            <p>{t("izinDitolakIsi")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {langkah.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
              <li>{t("izinGpsMenyala")}</li>
            </ol>
          </AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={onTap} disabled={busy} className="w-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("izinCobaLagi")}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  const label = autoCloseStoreName
    ? t("buttonAutoClose", { storeName: autoCloseStoreName })
    : t("button");
  const busyLabel = fetchingLocation ? t("locating") : t("submitting");

  return (
    <div className="space-y-2">
      {ditolak}
      <Button type="button" onClick={onTap} disabled={busy} className="w-full py-3 text-lg font-medium">
        {busy ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {busyLabel}
          </>
        ) : (
          label
        )}
      </Button>
      {error && (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
          <span>{error}</span>
          <Button type="button" variant="link" size="sm" onClick={onTap} disabled={busy}>{t("coordsRetry")}</Button>
        </div>
      )}
    </div>
  );
}
