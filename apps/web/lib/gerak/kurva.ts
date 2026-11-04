/**
 * Kurva dan jeda gerak bersama. Nilainya juga tertulis di globals.css
 * (`--ease-pegas`, jeda `.baris-berurutan`); `gerak-statis.test.ts` memastikan
 * keduanya tidak berselisih.
 */

export type Bezier = { x1: number; y1: number; x2: number; y2: number };

/**
 * Pegas lembut untuk dialog, panel, popover, dan lembar bawah: berangkat
 * cepat, melonjak sedikit melewati tujuan, lalu diam. y1 = 1,2 hanya
 * melonjak ±1 % — terasa hidup tanpa terlihat memantul.
 */
export const KURVA_PEGAS: Bezier = { x1: 0.22, y1: 1.2, x2: 0.36, y2: 1 };

/**
 * Panel samping dan lembar bawah HP: kurva lembar iOS — melesat lalu mengendap
 * panjang, terasa seperti pegas TANPA melewati tujuan. Lonjakan sekecil 1 %
 * pada lembar setinggi 85vh membuka celah beberapa piksel di tepi bawah layar.
 */
export const KURVA_LEMBAR: Bezier = { x1: 0.32, y1: 0.72, x2: 0, y2: 1 };

export function kurvaCss(k: Bezier): string {
  return `cubic-bezier(${k.x1}, ${k.y1}, ${k.x2}, ${k.y2})`;
}

/** Nilai tertinggi yang dicapai kurva (1 = tanpa lonjakan). */
export function puncakLonjakan(k: Bezier): number {
  let puncak = 0;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const u = 1 - t;
    const y = 3 * u * u * t * k.y1 + 3 * u * t * t * k.y2 + t * t * t;
    if (y > puncak) puncak = y;
  }
  return puncak;
}

/** Jarak antarbaris saat baris tabel muncul berurutan. */
export const LANGKAH_BERURUTAN_MS = 24;

/** Baris setelah ini muncul bersama baris terakhir yang berurutan. */
export const MAKS_BARIS_BERURUTAN = 12;

/** Jeda baris ke-`urutan` (mulai 1). */
export function jedaBaris(urutan: number): number {
  if (!(urutan >= 1)) return 0;
  return (Math.min(Math.floor(urutan), MAKS_BARIS_BERURUTAN) - 1) * LANGKAH_BERURUTAN_MS;
}
