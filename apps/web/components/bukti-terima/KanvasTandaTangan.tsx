"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";

export type PeganganTandaTangan = {
  /** Gambar tanda tangan sebagai PNG berlatar putih, atau `null` kalau kanvasnya masih kosong. */
  keBlob: () => Promise<Blob | null>;
  hapus: () => void;
};

type Titik = { x: number; y: number };

const TEBAL = 2.5;
const TINTA = "#111827";

/**
 * Kotak tanda tangan di layar.
 *
 * Coretan disimpan sebagai titik (dalam piksel CSS), bukan hanya sebagai
 * piksel kanvas: HP yang diputar mengubah ukuran kanvas, dan mengubah ukuran
 * kanvas menghapus isinya. Dengan titik, coretannya digambar ulang.
 *
 * Latarnya diisi PUTIH, bukan bening. Pengunggah (`perkecil`) mengubah gambar
 * besar menjadi JPEG, dan JPEG tidak punya bening — latar bening menjadi hitam,
 * dan tanda tangan hitam di atas hitam hilang.
 */
export function KanvasTandaTangan({
  ref,
  onChange,
  label,
  disabled = false,
  className,
}: {
  ref?: Ref<PeganganTandaTangan>;
  /** Dipanggil saat kanvas berubah antara kosong dan berisi. */
  onChange?: (berisi: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const kanvas = useRef<HTMLCanvasElement>(null);
  const coretan = useRef<Titik[][]>([]);
  const sedang = useRef<Titik[] | null>(null);

  const gambarUlang = useCallback(() => {
    const c = kanvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const lebar = c.clientWidth;
    const tinggi = c.clientHeight;
    if (c.width !== Math.round(lebar * dpr) || c.height !== Math.round(tinggi * dpr)) {
      c.width = Math.round(lebar * dpr);
      c.height = Math.round(tinggi * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lebar, tinggi);
    ctx.strokeStyle = TINTA;
    ctx.lineWidth = TEBAL;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const garis of coretan.current) {
      if (garis.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(garis[0].x, garis[0].y);
      if (garis.length === 1) ctx.lineTo(garis[0].x + 0.1, garis[0].y + 0.1);
      for (const t of garis.slice(1)) ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    gambarUlang();
    const c = kanvas.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const pengamat = new ResizeObserver(() => gambarUlang());
    pengamat.observe(c);
    return () => pengamat.disconnect();
  }, [gambarUlang]);

  useImperativeHandle(
    ref,
    () => ({
      keBlob: () =>
        new Promise<Blob | null>((selesai) => {
          const c = kanvas.current;
          if (!c || coretan.current.length === 0) return selesai(null);
          gambarUlang();
          c.toBlob((b) => selesai(b), "image/png");
        }),
      hapus: () => {
        coretan.current = [];
        sedang.current = null;
        gambarUlang();
        onChange?.(false);
      },
    }),
    [gambarUlang, onChange],
  );

  const titikDari = (e: React.PointerEvent<HTMLCanvasElement>): Titik => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={kanvas}
      role="img"
      aria-label={label}
      className={cn(
        "block h-48 w-full touch-none rounded-lg border bg-white",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair",
        className,
      )}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const garis = [titikDari(e)];
        sedang.current = garis;
        coretan.current.push(garis);
        gambarUlang();
        if (coretan.current.length === 1) onChange?.(true);
      }}
      onPointerMove={(e) => {
        const garis = sedang.current;
        if (!garis) return;
        const t = titikDari(e);
        const akhir = garis[garis.length - 1];
        garis.push(t);
        const ctx = e.currentTarget.getContext("2d");
        if (!ctx) return;
        ctx.strokeStyle = TINTA;
        ctx.lineWidth = TEBAL;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(akhir.x, akhir.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }}
      onPointerUp={() => {
        sedang.current = null;
      }}
      onPointerCancel={() => {
        sedang.current = null;
      }}
    />
  );
}
