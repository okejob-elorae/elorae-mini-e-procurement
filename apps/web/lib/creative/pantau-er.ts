/**
 * ER akun TikTok dari daftar posting profil — murni, aman untuk klien.
 *
 * Keputusan sementara P2 (ingatkan pemilik): rata-rata ER per posting atas
 * paling banyak 12 posting TERBARU yang tidak disematkan dan berumur ≥ 48 jam.
 * ER satu posting memakai rumus yang sama dengan `engagementRate`
 * (`angka-konten.ts`): (like + komentar + share + save) ÷ views × 100 — memuat
 * save, jadi sedikit lebih tinggi dari tolok ukur yang tidak memuatnya.
 * Posting dengan views 0 dilewati. Kurang dari 3 posting sah → ER dan
 * rata-rata views `null` (tidak dihitung), BUKAN 0.
 *
 * Yang dirata-rata adalah ER per posting, bukan total interaksi ÷ total views:
 * satu video viral tidak boleh menenggelamkan sebelas video biasa.
 */

import { totalInteraksi } from "./angka-konten";
import { pangkasInt, type PostingProfil } from "./pantau-muatan";

export type PostingPantau = PostingProfil;

export const MAKS_POSTING_ER = 12;
export const MIN_POSTING_ER = 3;
export const UMUR_MIN_POSTING_JAM = 48;
/** Kolom `er` adalah Decimal(6,2). */
export const MAKS_ER = 9999.99;

export type ErAkun = { er: number | null; avgViews: number | null; postsCounted: number };

const bulat2 = (n: number) => Math.round(Number((n * 100).toFixed(4))) / 100;

export function hitungErAkun(posting: readonly PostingPantau[], sekarang: Date): ErAkun {
  const batasDetik = Math.floor(sekarang.getTime() / 1000) - UMUR_MIN_POSTING_JAM * 3600;
  const dilihat = new Set<string>();
  const sah: PostingPantau[] = [];
  for (const p of posting) {
    if (dilihat.has(p.id)) continue;
    dilihat.add(p.id);
    if (p.disematkan || p.dibuatPada > batasDetik || !(p.views > 0)) continue;
    sah.push(p);
  }
  const dipakai = sah.sort((a, b) => b.dibuatPada - a.dibuatPada || a.id.localeCompare(b.id)).slice(0, MAKS_POSTING_ER);
  if (dipakai.length < MIN_POSTING_ER) return { er: null, avgViews: null, postsCounted: dipakai.length };

  const erPerPosting = dipakai.map(
    (p) => (totalInteraksi({ views: p.views, likes: p.like, comments: p.komentar, shares: p.share, saves: p.save }) / p.views) * 100,
  );
  const er = bulat2(erPerPosting.reduce((s, x) => s + x, 0) / dipakai.length);
  const avgViews = Math.round(dipakai.reduce((s, p) => s + p.views, 0) / dipakai.length);
  // Rata-rata views disimpan di kolom Int: video viral di atas 2,1 miliar dipangkas.
  return { er: Math.min(er, MAKS_ER), avgViews: pangkasInt(avgViews), postsCounted: dipakai.length };
}
