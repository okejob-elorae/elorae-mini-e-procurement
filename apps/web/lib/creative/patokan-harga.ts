/**
 * Patokan harga KOL dari data Elorae sendiri — murni, aman untuk klien.
 *
 * Pemilik (2026-10-09) menolak rentang harga asumsi: harga per 1.000 views harus berasal dari
 * kolaborasi yang benar-benar pernah dibayar. Satu sampel = satu kolaborasi berbayar yang sudah
 * tayang:
 *
 *   harga per 1.000 views = fee yang disepakati ÷ total views video TikTok-nya × 1.000
 *
 * - fee = Σ jumlah basis termin yang tidak batal (neto untuk gross-up, bruto untuk dipotong — arti
 *   "fee" yang sama dengan `angka-queries.ts`), atau `KolBrief.fee` bila belum ada termin. Itu angka
 *   yang dibandingkan dengan harga yang diminta KOL.
 * - views = jumlah angka TERAKHIR setiap video TikTok kolaborasi itu, dan setiap angka itu harus
 *   tercatat ≥ 7 hari sesudah tayang (sebagian besar views TikTok datang di minggu pertama; angka
 *   yang lebih muda membuat harga per 1.000 views tampak mahal). Satu video tanpa angka yang cukup
 *   tua → seluruh kolaborasi dilewati, karena fee-nya membayar semua video.
 * - Hanya tahap yang fee-nya sudah diakui (TAYANG, ANGKA_MASUK, DIBAYAR, SELESAI).
 *
 * Patokan = kuartil bawah, median, dan kuartil atas sampel itu — "separuh kolaborasi Anda
 * dibayar di antara A dan B per 1.000 views". Kurang dari 5 sampel → tidak ada patokan.
 */

import { feeDiakui, type Tahap } from "./tahap";

export const MIN_SAMPEL_PATOKAN = 5;
export const HARI_MIN_VIEWS = 7;

const HARI_MS = 86_400_000;

export type TerminPatokan = { status: string; bruto: number; neto: number; grossUp: boolean };
export type KontenPatokan = {
  platform: string;
  format: string;
  liveAt: Date | null;
  angkaTerakhir: { recordedAt: Date; views: number } | null;
};
export type KolaborasiPatokan = { id: string; tahap: Tahap; fee: number; termin: TerminPatokan[]; konten: KontenPatokan[] };

export type SampelPatokan = { kolaborasiId: string; fee: number; views: number; cpm: number };

export type PatokanHarga =
  | { n: number; cukup: false; minSampel: number; hariMinViews: number }
  | { n: number; cukup: true; minSampel: number; hariMinViews: number; p25: number; median: number; p75: number };

function feeDisepakati(k: KolaborasiPatokan): number {
  const hidup = k.termin.filter((t) => t.status !== "BATAL");
  if (!hidup.length) return k.fee;
  const sen = hidup.reduce((s, t) => s + Math.round((t.grossUp ? t.neto : t.bruto) * 100), 0);
  return sen / 100;
}

export function sampelPatokan(kolaborasi: readonly KolaborasiPatokan[]): SampelPatokan[] {
  const hasil: SampelPatokan[] = [];
  for (const k of kolaborasi) {
    if (!feeDiakui(k.tahap)) continue;
    const fee = feeDisepakati(k);
    if (!(fee > 0)) continue;
    const video = k.konten.filter((c) => c.platform === "TIKTOK" && c.format === "VIDEO");
    if (!video.length) continue;
    let views = 0;
    let sah = true;
    for (const c of video) {
      const a = c.angkaTerakhir;
      if (!c.liveAt || !a || a.recordedAt.getTime() - c.liveAt.getTime() < HARI_MIN_VIEWS * HARI_MS) {
        sah = false;
        break;
      }
      views += a.views;
    }
    if (!sah || !(views > 0)) continue;
    hasil.push({ kolaborasiId: k.id, fee, views, cpm: (fee / views) * 1000 });
  }
  return hasil;
}

/** Kuantil dengan interpolasi linier antar-urutan (= PERCENTILE.INC Excel). Daftar tidak boleh kosong. */
export function kuantil(angka: readonly number[], q: number): number {
  const a = [...angka].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const bawah = Math.floor(pos);
  const sisa = pos - bawah;
  return a[bawah] + (a[Math.min(bawah + 1, a.length - 1)] - a[bawah]) * sisa;
}

export function ringkasPatokan(sampel: readonly SampelPatokan[]): PatokanHarga {
  const dasar = { n: sampel.length, minSampel: MIN_SAMPEL_PATOKAN, hariMinViews: HARI_MIN_VIEWS };
  if (sampel.length < MIN_SAMPEL_PATOKAN) return { ...dasar, cukup: false };
  const cpm = sampel.map((s) => s.cpm);
  return {
    ...dasar,
    cukup: true,
    p25: Math.round(kuantil(cpm, 0.25)),
    median: Math.round(kuantil(cpm, 0.5)),
    p75: Math.round(kuantil(cpm, 0.75)),
  };
}
