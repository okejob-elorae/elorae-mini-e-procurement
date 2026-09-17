'use client';

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { INDEKS_DASAR } from '@/lib/creative/palet/harmoni';
import { hsbKeHex, hsvKeRgb, rybKeRgb, type Hsb } from '@/lib/creative/palet/warna';

/** Resolusi kanvas di dalam, bukan ukuran tampil — cukup tajam di layar retina. */
const UKURAN = 720;
const PUSAT = UKURAN / 2;
/** Jari-jari roda. Sisanya ruang untuk pegangan yang berada tepat di tepi. */
const JARI = 316;
const R_PEGANGAN = 22;
const R_DASAR = 31;

/**
 * Tabel rona per 0.1°. Roda digambar sekali, tapi setengah juta piksel yang
 * masing-masing menelusuri tabel pemetaan RYB tetap terasa saat halaman dibuka.
 */
function tabelRona(): Float32Array {
  const tabel = new Float32Array(3600);
  for (let i = 0; i < 3600; i++) tabel[i] = rybKeRgb(i / 10);
  return tabel;
}

function gambarRoda(kanvas: HTMLCanvasElement) {
  const ctx = kanvas.getContext('2d');
  if (!ctx) return;
  const rona = tabelRona();
  const gambar = ctx.createImageData(UKURAN, UKURAN);
  const d = gambar.data;
  for (let y = 0; y < UKURAN; y++) {
    for (let x = 0; x < UKURAN; x++) {
      const dx = x + 0.5 - PUSAT;
      const dy = y + 0.5 - PUSAT;
      const jarak = Math.hypot(dx, dy);
      if (jarak > JARI + 1) continue;
      // Sudut searah jarum jam dari arah jam 12 — merah di puncak roda.
      const sudut = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      const { r, g, b } = hsvKeRgb(rona[Math.floor(sudut * 10) % 3600], Math.min(1, jarak / JARI), 1);
      const i = (y * UKURAN + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      // Tepi dihaluskan satu piksel supaya lingkarannya tidak bergerigi.
      d[i + 3] = 255 * Math.min(1, Math.max(0, JARI + 0.5 - jarak));
    }
  }
  ctx.putImageData(gambar, 0, 0);
}

function posisi(w: Hsb): { x: number; y: number } {
  const rad = (w.h * Math.PI) / 180;
  const r = w.s * JARI;
  return { x: PUSAT + r * Math.sin(rad), y: PUSAT - r * Math.cos(rad) };
}

export function RodaWarna({
  warna,
  terpilih,
  onPilih,
  onGeser,
  labelPegangan,
}: {
  warna: Hsb[];
  terpilih: number;
  onPilih: (indeks: number) => void;
  onGeser: (indeks: number, h: number, s: number) => void;
  labelPegangan: (indeks: number, hex: string) => string;
}) {
  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const seret = useRef<number | null>(null);

  useEffect(() => {
    if (kanvasRef.current) gambarRoda(kanvasRef.current);
  }, []);

  function titik(e: PointerEvent): { h: number; s: number; jarak: number } {
    const kotak = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - kotak.left) * UKURAN) / kotak.width - PUSAT;
    const y = ((e.clientY - kotak.top) * UKURAN) / kotak.height - PUSAT;
    const jarak = Math.hypot(x, y);
    return {
      h: ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360,
      s: Math.min(1, jarak / JARI),
      jarak,
    };
  }

  function mulaiSeretPegangan(e: PointerEvent<SVGGElement>, indeks: number) {
    e.stopPropagation();
    e.preventDefault();
    // preventDefault juga mencegah fokus; fokus dipasang sendiri supaya panah
    // keyboard langsung bekerja pada pegangan yang baru dipegang.
    e.currentTarget.focus({ preventScroll: true });
    svgRef.current?.setPointerCapture(e.pointerId);
    seret.current = indeks;
    onPilih(indeks);
  }

  function tekanRoda(e: PointerEvent<SVGSVGElement>) {
    const t = titik(e);
    // Klik di luar lingkaran (sudut kotak) tidak memindahkan apa pun.
    if (t.jarak > JARI + R_PEGANGAN) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    seret.current = terpilih;
    onGeser(terpilih, t.h, t.s);
  }

  function gerak(e: PointerEvent<SVGSVGElement>) {
    if (seret.current === null) return;
    const t = titik(e);
    onGeser(seret.current, t.h, t.s);
  }

  function lepas(e: PointerEvent<SVGSVGElement>) {
    seret.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  }

  function tombol(e: KeyboardEvent<SVGGElement>, indeks: number) {
    const w = warna[indeks];
    const langkahRona = e.shiftKey ? 15 : 2;
    const langkahPekat = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowRight') onGeser(indeks, w.h + langkahRona, w.s);
    else if (e.key === 'ArrowLeft') onGeser(indeks, w.h - langkahRona, w.s);
    else if (e.key === 'ArrowUp') onGeser(indeks, w.h, w.s + langkahPekat);
    else if (e.key === 'ArrowDown') onGeser(indeks, w.h, w.s - langkahPekat);
    else return;
    e.preventDefault();
  }

  const titikPegangan = warna.map(posisi);
  const kecerahan = warna[terpilih]?.b ?? 1;
  // Yang terpilih digambar paling akhir supaya selalu di atas tumpukan —
  // pada Shades kelima pegangan berada di titik yang sama.
  const urutan = warna.map((_, i) => i).filter((i) => i !== terpilih).concat(terpilih);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
      <canvas ref={kanvasRef} width={UKURAN} height={UKURAN} className="absolute inset-0 h-full w-full" aria-hidden />
      {/*
       * Menggelapkan HSB sama dengan menumpuk hitam dengan tembus pandang
       * (1 − kecerahan), persis. Roda cukup digambar sekali; geseran kecerahan
       * hanya mengubah satu nilai opacity.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full bg-black"
        style={{
          left: `${((PUSAT - JARI) / UKURAN) * 100}%`,
          top: `${((PUSAT - JARI) / UKURAN) * 100}%`,
          width: `${((JARI * 2) / UKURAN) * 100}%`,
          height: `${((JARI * 2) / UKURAN) * 100}%`,
          opacity: 1 - kecerahan,
        }}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${UKURAN} ${UKURAN}`}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none"
        onPointerDown={tekanRoda}
        onPointerMove={gerak}
        onPointerUp={lepas}
        onPointerCancel={lepas}
      >
        {titikPegangan.map((p, i) => (
          <line key={`bayang-${i}`} x1={PUSAT} y1={PUSAT} x2={p.x} y2={p.y} stroke="rgba(0,0,0,0.3)" strokeWidth={6} strokeLinecap="round" />
        ))}
        {titikPegangan.map((p, i) => (
          <line key={`garis-${i}`} x1={PUSAT} y1={PUSAT} x2={p.x} y2={p.y} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
        ))}
        <circle cx={PUSAT} cy={PUSAT} r={6} fill="white" stroke="rgba(0,0,0,0.3)" strokeWidth={2} />

        {urutan.map((i) => {
          const p = titikPegangan[i];
          const hex = hsbKeHex(warna[i]);
          const r = i === INDEKS_DASAR ? R_DASAR : R_PEGANGAN;
          const aktif = i === terpilih;
          return (
            <g
              key={i}
              role="button"
              tabIndex={0}
              aria-label={labelPegangan(i, hex.toUpperCase())}
              aria-pressed={aktif}
              className="cursor-grab outline-none active:cursor-grabbing"
              onPointerDown={(e) => mulaiSeretPegangan(e, i)}
              onFocus={() => onPilih(i)}
              onKeyDown={(e) => tombol(e, i)}
            >
              {/* Cincin ganda hitam-putih: terlihat di atas warna apa pun, terang maupun gelap. */}
              {aktif && (
                <>
                  <circle cx={p.x} cy={p.y} r={r + 12} fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={5} />
                  <circle cx={p.x} cy={p.y} r={r + 12} fill="none" stroke="white" strokeWidth={2} />
                </>
              )}
              <circle cx={p.x} cy={p.y + 3} r={r + 3} fill="rgba(0,0,0,0.3)" />
              <circle cx={p.x} cy={p.y} r={r} fill={hex} stroke="white" strokeWidth={5} />
              {i === INDEKS_DASAR && <circle cx={p.x} cy={p.y} r={6} fill="white" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
