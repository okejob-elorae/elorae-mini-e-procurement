/**
 * "Lewat jatuh tempo" — tunggakan yang dihitung dari tanggal jatuh tempo
 * FAKTUR, terpisah dari "lewat janji bayar" yang dihitung dari kontrabon.
 *
 * Enam keadaan di `rules.ts` adalah keadaan uang. Yang ini keadaan TAMPILAN:
 * faktur `belum` (tanpa kontrabon, tanpa klaim, tanpa tahanan) yang jatuh
 * temponya sudah lewat. Dulu faktur seperti ini berlabel "tidak ada tunggakan"
 * dan tidak tercantum di daftar tindakan mana pun.
 *
 * Murni dan bebas Prisma — boleh diimpor komponen klien.
 */

import { tanggalWib } from '@/lib/dashboard/hari-wib';
import type { JenisTahanan, KeadaanPiutang } from './rules';

export type KeadaanTampil = KeadaanPiutang | 'jatuh_tempo';

/** Urutan tampil: yang menuntut tindakan lebih dulu. Satu urutan untuk semua layar kantor. */
export const URUT_KEADAAN_TAMPIL: readonly KeadaanTampil[] = [
  'lewat',
  'jatuh_tempo',
  'tertahan',
  'klaim',
  'tt',
  'belum',
  'lunas',
];

const HARI_MS = 86_400_000;

/**
 * Berapa hari kalender WIB faktur ini lewat jatuh tempo, atau `null`.
 *
 * Hanya keadaan `belum`. Kontrabon berjalan memakai janji bayarnya sendiri
 * (`lewat`), klaim yang menunggu berarti sales sudah melapor, dan tahanan retur
 * adalah aturan uang — ketiganya bukan tunggakan yang dikejar dari jatuh tempo.
 *
 * Dibandingkan per hari WIB: hari jatuh temponya sendiri belum lewat.
 */
export function hariLewatJatuhTempo(b: {
  keadaan: KeadaanPiutang;
  dueDate: Date;
  hariIni: Date;
}): number | null {
  if (b.keadaan !== 'belum') return null;
  return hariSejakTempo(b.dueDate, b.hariIni);
}

/** Hari kalender WIB sejak jatuh tempo, atau `null` kalau belum lewat. */
function hariSejakTempo(dueDate: Date, hariIni: Date): number | null {
  const tempo = Date.parse(`${tanggalWib(dueDate)}T00:00:00Z`);
  const kini = Date.parse(`${tanggalWib(hariIni)}T00:00:00Z`);
  const hari = Math.round((kini - tempo) / HARI_MS);
  return hari > 0 ? hari : null;
}

/**
 * Bagian yang BOLEH ditagih dari faktur yang sebagian ditahan retur, kalau
 * jatuh temponya sudah lewat (P46, jawaban pemilik 2026-11-02 "setuju"): nota
 * yang sebagian ditahan juga masuk "Lewat jatuh tempo", sebesar bagian yang
 * diingatkan (Q15). Kontrabon berjalan memakai janji bayarnya sendiri.
 */
export function lewatTempoDiLuarTahanan(b: {
  keadaan: KeadaanPiutang;
  bebas: number;
  adaKontrabon: boolean;
  dueDate: Date;
  hariIni: Date;
}): { hari: number; nilai: number } | null {
  if (b.keadaan !== "tertahan" || b.adaKontrabon || !(b.bebas > 0)) return null;
  const hari = hariSejakTempo(b.dueDate, b.hariIni);
  return hari === null ? null : { hari, nilai: b.bebas };
}

/** Bahan kalimat "tertahan": yang menunggu (dan sebabnya), yang tetap, dan bagian yang lewat tempo. */
export type KalimatTertahan = {
  tunggu: { nilai: number; sebab: JenisTahanan } | null;
  tetap: number | null;
  lewatTempo: { nilai: number; hari: number } | null;
};

export function kalimatTertahan(alasan: {
  nilaiTertahan?: number;
  ditahanRetur?: number;
  sebabDitahan?: JenisTahanan;
  lewatTempoDiLuarTahanan?: { hari: number; nilai: number };
}): KalimatTertahan {
  const tunggu =
    (alasan.ditahanRetur ?? 0) > 0 && alasan.sebabDitahan
      ? { nilai: alasan.ditahanRetur ?? 0, sebab: alasan.sebabDitahan }
      : null;
  const sisaTetap = (alasan.nilaiTertahan ?? 0) - (alasan.ditahanRetur ?? 0);
  return {
    tunggu,
    tetap: sisaTetap > 0 ? sisaTetap : null,
    lewatTempo: alasan.lewatTempoDiLuarTahanan ?? null,
  };
}

/** Satu bagian kalimat "tertahan", dalam urutan tampilnya. */
export type BagianTertahan =
  | { jenis: "TUNGGU"; sebab: JenisTahanan; nilai: number }
  | { jenis: "TETAP"; nilai: number }
  | { jenis: "LEWAT_TEMPO"; adaTunggu: boolean; nilai: number; hari: number }
  | { jenis: "TAGIH_BKM" }
  | { jenis: "UMUM"; nilai: number };

/**
 * SATU aturan susunan kalimat "tertahan" (Q15/P46) untuk setiap layar — kantor, HP, dasbor — supaya
 * kalimatnya tidak pernah berbeda antar-layar; tiap layar hanya memilih kata untuk tiap bagian:
 *
 * 1. `TUNGGU` — yang menunggu dan sebabnya;
 * 2. `TETAP` — potongan yang tidak jadi diakui, tetap utang toko;
 * 3. `LEWAT_TEMPO` — bagian di luar tahanan yang sudah lewat jatuh tempo (`adaTunggu`: kalimatnya
 *    "di luar tahanan" atau "seluruhnya"); tanpa itu, `TAGIH_BKM` bila ada bagian tetap — ditagih
 *    lewat BKM berikutnya;
 * 4. `UMUM` — hanya bila tidak ada bahan rincian sama sekali: kalimat umumnya.
 */
export function bagianKalimatTertahan(alasan: Parameters<typeof kalimatTertahan>[0]): BagianTertahan[] {
  const k = kalimatTertahan(alasan);
  const bagian: BagianTertahan[] = [];
  if (k.tunggu) bagian.push({ jenis: "TUNGGU", sebab: k.tunggu.sebab, nilai: k.tunggu.nilai });
  if (k.tetap) bagian.push({ jenis: "TETAP", nilai: k.tetap });
  if (k.lewatTempo) bagian.push({ jenis: "LEWAT_TEMPO", adaTunggu: k.tunggu !== null, nilai: k.lewatTempo.nilai, hari: k.lewatTempo.hari });
  else if (k.tetap) bagian.push({ jenis: "TAGIH_BKM" });
  if (bagian.length === 0) bagian.push({ jenis: "UMUM", nilai: alasan.nilaiTertahan ?? 0 });
  return bagian;
}

/**
 * SATU definisi "Lewat jatuh tempo" (P46) untuk setiap layar: faktur
 * `jatuh_tempo`, ATAU faktur tertahan yang bagian bebasnya sudah lewat tempo.
 */
export function masukLewatJatuhTempo(b: {
  keadaanTampil: KeadaanTampil;
  alasan?: { lewatTempoDiLuarTahanan?: unknown };
}): boolean {
  return b.keadaanTampil === "jatuh_tempo" || Boolean(b.alasan?.lewatTempoDiLuarTahanan);
}

/** Nilai yang dihitung di "Lewat jatuh tempo": seluruh sisa, atau hanya bagian bebasnya. `null` = tidak masuk. */
export function nilaiLewatJatuhTempo(b: {
  keadaanTampil: KeadaanTampil;
  outstanding: number;
  alasan?: { lewatTempoDiLuarTahanan?: { nilai: number } };
}): number | null {
  if (b.keadaanTampil === "jatuh_tempo") return b.outstanding;
  return b.alasan?.lewatTempoDiLuarTahanan?.nilai ?? null;
}

export function keadaanTampil(b: {
  keadaan: KeadaanPiutang;
  hariLewatJatuhTempo: number | null;
}): KeadaanTampil {
  return b.keadaan === 'belum' && b.hariLewatJatuhTempo !== null ? 'jatuh_tempo' : b.keadaan;
}

/** `?keadaan=` dari alamat. Nilai lain diabaikan, bukan ditolak. */
export function bacaKeadaanTampil(raw: string | undefined | null): KeadaanTampil | null {
  return raw && (URUT_KEADAAN_TAMPIL as readonly string[]).includes(raw) ? (raw as KeadaanTampil) : null;
}
