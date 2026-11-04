import { SANDI_MIN } from "@/lib/users/validasi";

/**
 * Alasan tombol di Pengaturan → Keamanan masih mati — isian pertama yang kurang,
 * urut formulir. Aturannya sama dengan pemeriksaan sebelum mengirim (dan
 * server): sandi minimal `SANDI_MIN_KEAMANAN` — sama dengan formulir Pengguna
 * (`SANDI_MIN`), satu aturan panjang sandi — PIN 4–6 digit.
 */
export const SANDI_MIN_KEAMANAN = SANDI_MIN;

export type AlasanSandi = "passwordCurrent" | "passwordNew" | "passwordRepeat";
export type AlasanPin = "pinNew" | "pinRepeat";

export function alasanSandiBelum(isian: { lama: string; baru: string; ulang: string }): AlasanSandi | null {
  if (!isian.lama.trim()) return "passwordCurrent";
  if (!isian.baru.trim() || isian.baru.length < SANDI_MIN_KEAMANAN) return "passwordNew";
  if (isian.baru !== isian.ulang) return "passwordRepeat";
  return null;
}

export function alasanPinBelum(isian: { baru: string; ulang: string }): AlasanPin | null {
  if (!/^\d{4,6}$/.test(isian.baru)) return "pinNew";
  if (isian.baru !== isian.ulang) return "pinRepeat";
  return null;
}
