/*
 * Pilihan bulan tab Kalender Plan Kerja — murni, aman untuk klien dan tes.
 */

/** `?bulan=` yang sah (1–12), selain itu null. */
export function bacaBulanUrl(nilai: string | null): number | null {
  if (!nilai || !/^\d{1,2}$/.test(nilai)) return null;
  const n = Number(nilai);
  return n >= 1 && n <= 12 ? n : null;
}

/**
 * Bulan yang dibuka: dari URL; bila tidak ada, bulan ini bila tahun plan =
 * tahun ini (WIB); selain itu Januari. `hariIni` = "YYYY-MM-DD" hari WIB.
 */
export function bulanAwalKalender(bulanUrl: number | null, tahun: number, hariIni: string): number {
  if (bulanUrl) return bulanUrl;
  const [tahunIni, bulanIni] = hariIni.split("-").map(Number);
  return tahun === tahunIni && bulanIni >= 1 && bulanIni <= 12 ? bulanIni : 1;
}
