/**
 * Aturan formulir pengguna — murni, dites.
 *
 * SPG dikenali aplikasi dari TOKO TETAP (`User.assignedStoreId`), bukan dari
 * nama perannya. Karena itu toko tetap wajib untuk peran yang bisa mencatat
 * penjualan SPG, dan dikosongkan untuk peran lain — pengguna lain yang
 * kebetulan punya toko tetap akan diperlakukan sebagai SPG di HP.
 */

export type KodeValidasi =
  | "NAMA_WAJIB"
  | "EMAIL_TIDAK_VALID"
  | "SANDI_WAJIB"
  | "SANDI_PENDEK"
  | "SANDI_TIDAK_SAMA"
  | "TOKO_WAJIB";

export const SANDI_MIN = 8;

export function rapikanEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function perannyaSpg(kodeIzin: string[]): boolean {
  return kodeIzin.includes("spg_sales:record");
}

export function validasiPengguna(input: {
  baru: boolean;
  nama: string;
  email: string;
  sandi: string;
  ulangSandi: string;
  butuhToko: boolean;
  tokoId: string | null;
}): KodeValidasi[] {
  const galat: KodeValidasi[] = [];
  if (!input.nama.trim()) galat.push("NAMA_WAJIB");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rapikanEmail(input.email))) galat.push("EMAIL_TIDAK_VALID");
  // Saat mengubah, sandi kosong = tetap memakai sandi lama.
  const isiSandi = input.sandi !== "" || input.ulangSandi !== "";
  if (input.baru && !isiSandi) galat.push("SANDI_WAJIB");
  if (isiSandi) {
    if (input.sandi.length < SANDI_MIN) galat.push("SANDI_PENDEK");
    else if (input.sandi !== input.ulangSandi) galat.push("SANDI_TIDAK_SAMA");
  }
  if (input.butuhToko && !input.tokoId) galat.push("TOKO_WAJIB");
  return galat;
}
