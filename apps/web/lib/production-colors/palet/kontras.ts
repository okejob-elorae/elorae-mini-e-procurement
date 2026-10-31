import { hexKeRgb } from './warna';

/**
 * Keterbacaan menurut WCAG 2.
 *
 * Luminansi relatif memakai ambang 0.04045 dari spesifikasi sRGB; WCAG 2.0
 * menulis 0.03928, dan W3C sendiri sudah mencatat bahwa keduanya memberi hasil
 * yang sama untuk setiap warna 8-bit.
 */
function luminansi(hex: string): number {
  const { r, g, b } = hexKeRgb(hex);
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** 1 (tak terbedakan) sampai 21 (hitam di atas putih). Urutan tidak penting. */
export function rasioKontras(a: string, b: string): number {
  const la = luminansi(a);
  const lb = luminansi(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type TingkatKontras = 'AAA' | 'AA' | 'AA_BESAR' | 'GAGAL';

/**
 * - `AAA` ≥ 7: nyaman untuk teks panjang.
 * - `AA` ≥ 4.5: cukup untuk teks biasa.
 * - `AA_BESAR` ≥ 3: hanya untuk tulisan besar (≥ 24px, atau ≥ 19px tebal).
 * - `GAGAL`: jangan dipakai untuk tulisan.
 *
 * Dinilai dari rasio mentah, bukan dari angka yang tampil.
 */
export function tingkatKontras(rasio: number): TingkatKontras {
  if (rasio >= 7) return 'AAA';
  if (rasio >= 4.5) return 'AA';
  if (rasio >= 3) return 'AA_BESAR';
  return 'GAGAL';
}

/**
 * Rasio untuk ditampilkan, satu desimal, DIBULATKAN KE BAWAH.
 *
 * Pembulatan biasa mengubah 4.48 menjadi "4.5" di samping label "AA besar" —
 * layarnya membantah dirinya sendiri, dan orang memercayai angkanya. Karena
 * setiap ambang WCAG punya paling banyak satu desimal (3, 4.5, 7), angka yang
 * dibulatkan ke bawah lolos ambang tepat ketika rasio mentahnya lolos.
 */
export function tampilRasio(rasio: number): number {
  return Math.floor(rasio * 10 + 1e-9) / 10;
}

/** Warna tulisan (putih atau hitam) yang paling terbaca di atas `hex` — untuk huruf di atas contoh warna. */
export function tintaDi(hex: string): '#ffffff' | '#000000' {
  return rasioKontras(hex, '#ffffff') >= rasioKontras(hex, '#000000') ? '#ffffff' : '#000000';
}
