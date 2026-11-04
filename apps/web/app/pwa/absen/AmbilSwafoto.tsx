"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Camera, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "memuat" | "langsung" | "galat" | "pratinjau";
type Hasil = { blob: Blob; url: string };

/**
 * Kamera swafoto layar penuh untuk absen — pola yang sama dengan
 * `VisitPhotoCapture` (kamera langsung → pratinjau → Ulangi/Pakai), tapi
 * kamera DEPAN (`facingMode: "user"`).
 *
 * Aliran kamera dipasang ke <video> di efek SESUDAH mode berganti ke
 * "langsung", bukan seketika: memasangnya sebelum React menaruh <video>
 * membuat layar kamera hitam (pelajaran dari foto kunjungan).
 *
 * Tanpa izin kamera (atau peramban tanpa getUserMedia), tombol "Buka kamera
 * HP" memakai kamera bawaan lewat <input capture="user"> — harus dari ketukan
 * orangnya sendiri, karena peramban menolak membuka pemilih berkas tanpa itu.
 */
export function AmbilSwafoto({
  sibuk,
  onPakai,
  onTutup,
}: {
  sibuk: boolean;
  onPakai: (blob: Blob, catatan: string) => void;
  onTutup: () => void;
}) {
  const t = useTranslations("pwa.absen.kamera");
  const [mode, setMode] = useState<Mode>("memuat");
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [catatan, setCatatan] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const berkasRef = useRef<HTMLInputElement | null>(null);

  const matikan = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("tanpa kamera");
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (batal) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = s;
        setMode("langsung");
      } catch {
        if (!batal) setMode("galat");
      }
    })();
    return () => {
      batal = true;
      matikan();
    };
  }, []);

  useEffect(() => {
    if (mode === "langsung" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [mode]);

  // URL pratinjau dilepas setiap kali diganti dan saat ditutup.
  useEffect(() => () => {
    if (hasil) URL.revokeObjectURL(hasil.url);
  }, [hasil]);

  const jepret = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0 || v.videoHeight === 0) return;
    const kanvas = document.createElement("canvas");
    kanvas.width = v.videoWidth;
    kanvas.height = v.videoHeight;
    kanvas.getContext("2d")?.drawImage(v, 0, 0);
    kanvas.toBlob(
      (blob) => {
        if (!blob) return;
        setHasil({ blob, url: URL.createObjectURL(blob) });
        setMode("pratinjau");
      },
      "image/jpeg",
      0.9,
    );
  };

  const ulangi = () => {
    setHasil(null);
    // Tanpa kamera langsung, kembali ke tombol "Buka kamera HP": membuka
    // pemilih berkas dari sini bisa ditolak peramban, dan batal memilih akan
    // meninggalkan pratinjau kosong.
    setMode(streamRef.current ? "langsung" : "galat");
  };

  const tutup = () => {
    matikan();
    onTutup();
  };

  // Hanya dipasang sesudah ketukan di browser, tapi tetap dijaga untuk render server.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t("judul")}>
      {mode === "memuat" || mode === "galat" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          {mode === "memuat" ? (
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          ) : (
            <>
              <p className="text-sm text-white/80">{t("tanpaIzin")}</p>
              <Button onClick={() => berkasRef.current?.click()} disabled={sibuk}>
                <Camera className="mr-2 h-4 w-4" aria-hidden />
                {t("bukaKameraHp")}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {mode === "langsung" ? (
        // Dicerminkan hanya di layar, seperti cermin; hasil jepretan tidak.
        <video ref={videoRef} autoPlay playsInline muted className="min-h-0 w-full flex-1 -scale-x-100 object-cover" />
      ) : null}

      {mode === "pratinjau" && hasil ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hasil.url} alt={t("pratinjau")} className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}

      <div className="space-y-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {mode === "pratinjau" ? (
          <>
            <Input
              value={catatan}
              maxLength={500}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder={t("catatan")}
              aria-label={t("catatan")}
              disabled={sibuk}
              className="border-white/20 bg-white/10 text-white placeholder:text-white/60"
            />
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" size="lg" onClick={ulangi} disabled={sibuk}>
                <RotateCcw className="mr-2 h-5 w-5" aria-hidden />
                {t("ulangi")}
              </Button>
              <Button className="flex-1" size="lg" onClick={() => hasil && onPakai(hasil.blob, catatan)} disabled={sibuk}>
                {sibuk ? <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> : <Check className="mr-2 h-5 w-5" aria-hidden />}
                {t("pakai")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={tutup} aria-label={t("tutup")}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
            {mode === "langsung" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={jepret}
                aria-label={t("jepret")}
                className="h-16 w-16 rounded-full border-4 border-white bg-white/30 p-0 hover:bg-white/40 active:scale-95"
              />
            ) : null}
            <span className="h-11 w-11" aria-hidden />
          </div>
        )}
      </div>

      <input
        ref={berkasRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            setHasil({ blob: f, url: URL.createObjectURL(f) });
            setMode("pratinjau");
          }
        }}
      />
    </div>,
    document.body,
  );
}
