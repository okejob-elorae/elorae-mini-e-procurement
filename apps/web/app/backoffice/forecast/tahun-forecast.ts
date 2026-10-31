// Pilihan tahun forecast (aman untuk klien).
import { tanggalWib } from "@/lib/dashboard/hari-wib";

/** Berapa tahun ke depan yang bisa diramal (tahun berjalan + N). */
export const TAHUN_FORECAST_KE_DEPAN = 2;
/** Berapa tahun ke belakang yang tetap bisa dibuka. */
export const TAHUN_FORECAST_KE_BELAKANG = 2;
/** Mulai bulan ini (WIB), bawaan forecast pindah ke tahun depan — saat merencanakan produksi tahun depan. */
export const BULAN_MULAI_TAHUN_DEPAN = 7;
/** Pola musiman butuh minimal satu tahun data penjualan. */
export const MIN_BULAN_DATA_MUSIMAN = 12;

function tahunBulanWib(sekarang: Date): { tahun: number; bulan: number } {
  const [tahun, bulan] = tanggalWib(sekarang).split("-").map(Number);
  return { tahun, bulan };
}

/** Tahun berjalan − 2 sampai tahun berjalan + 2 (WIB). */
export function pilihanTahunForecast(sekarang: Date = new Date()): number[] {
  const { tahun } = tahunBulanWib(sekarang);
  const hasil: number[] = [];
  for (let y = tahun - TAHUN_FORECAST_KE_BELAKANG; y <= tahun + TAHUN_FORECAST_KE_DEPAN; y++) hasil.push(y);
  return hasil;
}

/** Tahun bawaan: tahun depan mulai Juli (WIB), sebelumnya tahun berjalan. */
export function tahunForecastBawaan(sekarang: Date = new Date()): number {
  const { tahun, bulan } = tahunBulanWib(sekarang);
  return bulan >= BULAN_MULAI_TAHUN_DEPAN ? tahun + 1 : tahun;
}

/** Tahun dari URL bila termasuk pilihan; selain itu bawaan. */
export function tahunForecastDariUrl(nilai: string | null, sekarang: Date = new Date()): number {
  const n = Number(nilai);
  return Number.isInteger(n) && pilihanTahunForecast(sekarang).includes(n) ? n : tahunForecastBawaan(sekarang);
}
