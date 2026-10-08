import { validasiPengguna, type KodeValidasi } from "@/lib/users/validasi";

export type AlasanBelumSimpan = KodeValidasi | "PERAN_WAJIB";

/** Urutan isian di formulir — alasan yang disebut adalah yang pertama dari atas. */
const URUTAN: readonly AlasanBelumSimpan[] = [
  "NAMA_WAJIB",
  "EMAIL_TIDAK_VALID",
  "PERAN_WAJIB",
  "TOKO_WAJIB",
  "SANDI_WAJIB",
  "SANDI_PENDEK",
  "SANDI_TIDAK_SAMA",
];

/**
 * Isian pertama yang membuat tombol Simpan mati, atau null bila lengkap.
 * Aturannya sama dengan server (`validasiPengguna`) ditambah peran wajib.
 */
export function alasanBelumBisaSimpan(
  draf: { id: string | null; nama: string; email: string; roleId: string; tokoId: string | null; sandi: string; ulangSandi: string },
  peran: { spg: boolean } | undefined,
): AlasanBelumSimpan | null {
  const galat: AlasanBelumSimpan[] = validasiPengguna({
    baru: draf.id === null,
    nama: draf.nama,
    email: draf.email,
    sandi: draf.sandi,
    ulangSandi: draf.ulangSandi,
    butuhToko: peran?.spg ?? false,
    tokoId: draf.tokoId,
  });
  if (!draf.roleId) galat.push("PERAN_WAJIB");
  return URUTAN.find((k) => galat.includes(k)) ?? null;
}
