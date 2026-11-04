// Tahun yang diusulkan dialog "Tambah tahun" (aman untuk klien).
import { tahunForecastBawaan } from "@/app/backoffice/forecast/tahun-forecast";

/**
 * Usulan tahun plan baru: sama dengan tahun bawaan Forecast (tahun depan mulai
 * Juli WIB, sebelumnya tahun berjalan) supaya jembatan Forecast → Plan Kerja
 * tidak membuat tahun yang salah. Tahun yang sudah punya plan dilewati.
 */
export function usulanTahunPlan(tahunAda: readonly number[], sekarang: Date = new Date()): number {
  const ada = new Set(tahunAda);
  let tahun = tahunForecastBawaan(sekarang);
  while (ada.has(tahun)) tahun += 1;
  return tahun;
}
