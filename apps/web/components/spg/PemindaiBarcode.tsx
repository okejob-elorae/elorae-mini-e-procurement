"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Camera, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { siapkanDetektor, type Detektor } from "@/lib/barcode/detektor";

/**
 * Pemindai barcode untuk SPG — dua jalan masuk, satu keluaran (`onKode`).
 *
 * 1. Kolom ketik. Pemindai Bluetooth/USB bekerja sebagai papan ketik: ia
 *    "mengetik" kodenya lalu menekan Enter. Kolom yang sama menerima ketikan
 *    tangan (SKU dari label).
 * 2. Kamera, di HP apa pun: pembaca bawaan browser kalau ada, pembaca
 *    cadangan (ZXing) kalau tidak — lihat `lib/barcode/detektor.ts`. Tombol
 *    kamera hanya disembunyikan kalau browser tidak bisa membuka kamera sama
 *    sekali (halaman http di luar localhost).
 *
 * Kamera tetap terbuka setelah satu kode terbaca, supaya SPG bisa memindai
 * beberapa barang berturut-turut; kode yang sama dalam 1,5 detik diabaikan
 * (satu label tertangkap berkali-kali selama masih di depan kamera). Pemanggil
 * mengembalikan `"tutup"` dari `onKode` kalau kode itu butuh layar lain
 * (mis. memilih ukuran) — kamera penuh layar akan menutupinya.
 */

const JEDA_SAMA_MS = 1_500;

const tanpaLangganan = () => () => {};

export function PemindaiBarcode({
  onKode,
  placeholder,
  autoFocus = false,
}: {
  onKode: (kode: string) => void | "tutup";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("pwa.pemindai");
  const [teks, setTeks] = useState("");
  const [terbuka, setTerbuka] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [terakhir, setTerakhir] = useState<string | null>(null);
  const [detektor, setDetektor] = useState<Detektor | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const kodeTerakhir = useRef<{ kode: string; pada: number } | null>(null);
  const onKodeRef = useRef(onKode);
  useEffect(() => {
    onKodeRef.current = onKode;
  }, [onKode]);

  // Dukungan kamera dibaca di klien saja; di server dianggap tidak ada, supaya
  // HTML server dan klien tidak berbeda. `mediaDevices` hanya ada di konteks
  // aman (https atau localhost).
  const bisaKamera = useSyncExternalStore(tanpaLangganan, () => !!navigator.mediaDevices?.getUserMedia, () => false);

  const tutup = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setTerbuka(false);
  };
  const tutupRef = useRef(tutup);
  useEffect(() => {
    tutupRef.current = tutup;
  });
  useEffect(() => () => streamRef.current?.getTracks().forEach((tr) => tr.stop()), []);

  const buka = async () => {
    setGalat(null);
    setTerakhir(null);
    // Pembaca disiapkan bersamaan dengan kamera. Di browser tanpa pembaca
    // bawaan, yang pertama kali memuat mesin cadangan (~1 MB) — kamera sudah
    // tampil dengan tulisan "menyiapkan" selama itu.
    const pembaca = siapkanDetektor();
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      setGalat(t("cameraDenied"));
      return;
    }
    setTerbuka(true);
    try {
      setDetektor(await pembaca);
    } catch {
      tutupRef.current();
      setGalat(t("loadFailed"));
    }
  };

  // Pasang aliran SETELAH <video> ada di layar — memasangnya saat membuka
  // berlomba dengan render dan menghasilkan layar hitam.
  useEffect(() => {
    if (!terbuka || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => {});
    }

    if (!detektor) return;
    let berhenti = false;
    let sibuk = false;
    const putaran = window.setInterval(async () => {
      if (berhenti || sibuk || video.readyState < 2) return;
      sibuk = true;
      try {
        const hasil = await detektor.detect(video);
        const kode = hasil[0]?.rawValue?.trim();
        if (kode) {
          const lalu = kodeTerakhir.current;
          const sekarang = Date.now();
          if (!lalu || lalu.kode !== kode || sekarang - lalu.pada > JEDA_SAMA_MS) {
            kodeTerakhir.current = { kode, pada: sekarang };
            navigator.vibrate?.(60);
            setTerakhir(kode);
            if (onKodeRef.current(kode) === "tutup") tutupRef.current();
          }
        }
      } catch {
        // Bingkai yang gagal dibaca bukan galat — coba lagi di putaran berikut.
      } finally {
        sibuk = false;
      }
    }, 250);
    return () => {
      berhenti = true;
      window.clearInterval(putaran);
    };
  }, [terbuka, detektor]);

  const kirimTeks = () => {
    const kode = teks.trim();
    if (!kode) return;
    onKode(kode);
    setTeks("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                kirimTeks();
              }
            }}
            placeholder={placeholder ?? t("placeholder")}
            aria-label={placeholder ?? t("placeholder")}
            autoFocus={autoFocus}
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="search"
            className="pl-9"
          />
        </div>
        {bisaKamera ? (
          <Button type="button" variant="outline" size="icon" onClick={buka} aria-label={t("openCamera")}>
            <Camera className="h-5 w-5" />
          </Button>
        ) : null}
      </div>
      {galat ? <p className="text-xs text-destructive">{galat}</p> : null}

      {terbuka && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex flex-col bg-black" role="dialog" aria-label={t("cameraTitle")}>
              <div className="relative min-h-0 flex-1">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                {/* Bingkai bidik: membantu SPG menaruh label di tengah. */}
                <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-xl border-2 border-white/80" />
              </div>
              <div className="flex items-center justify-between gap-3 bg-black px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
                <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
                  {!detektor ? t("preparing") : terakhir ? t("lastRead", { code: terakhir }) : t("pointAtLabel")}
                </p>
                <Button type="button" variant="secondary" onClick={tutup}>
                  <X className="h-4 w-4" />
                  {t("done")}
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
