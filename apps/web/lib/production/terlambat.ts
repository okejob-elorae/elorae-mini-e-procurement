// Bukan aksi server: satu definisi "perintah kerja terlambat" (aman untuk klien).
import { batasHariIniWib, tanggalWib } from "@/lib/dashboard/hari-wib";

/** Status WO yang masih berjalan — hanya ini yang bisa terlambat. */
export const STATUS_WO_AKTIF = ["ISSUED", "IN_PRODUCTION", "PARTIAL"] as const;

const HARI_MS = 86_400_000;

/**
 * Berapa hari WO lewat tanggal targetnya (hari kalender WIB), atau null bila
 * tidak terlambat: tanpa target, status bukan aktif (draf/selesai/batal), atau
 * targetnya hari ini atau nanti.
 */
export function hariTerlambatWo(
  targetDate: Date | string | null | undefined,
  status: string,
  sekarang: Date = new Date(),
): number | null {
  if (!targetDate || !(STATUS_WO_AKTIF as readonly string[]).includes(status)) return null;
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) return null;
  const hariTarget = Date.parse(`${tanggalWib(target)}T00:00:00Z`);
  const hariIni = Date.parse(`${batasHariIniWib(sekarang).tanggal}T00:00:00Z`);
  const selisih = Math.round((hariIni - hariTarget) / HARI_MS);
  return selisih > 0 ? selisih : null;
}

/** Potongan `where` Prisma untuk WO terlambat — sama dengan `hariTerlambatWo`. */
export function whereWoTerlambat(sekarang: Date = new Date()) {
  return {
    status: { in: [...STATUS_WO_AKTIF] },
    targetDate: { lt: batasHariIniWib(sekarang).awal },
  };
}
