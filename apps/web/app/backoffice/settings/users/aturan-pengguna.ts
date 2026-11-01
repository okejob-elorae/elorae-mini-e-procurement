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

export type DrafPengguna = {
  id: string | null;
  nama: string;
  email: string;
  roleId: string;
  tokoId: string | null;
  sandi: string;
  ulangSandi: string;
};

/** Formulir yang dibuka langsung dari alamat halaman. */
export type BukaAwal = { jenis: "baru" } | { jenis: "ubah"; id: string };

/**
 * `?baru=1` → formulir tambah; `?ubah=<id>` → formulir akun itu. Dipakai rute
 * Akun Profil yang sudah ditutup (`app/backoffice/profile-accounts/tujuan.ts`),
 * supaya tautan lama "buat akun" dan "ubah akun" tetap membuka formulirnya.
 * `ubah` menang bila keduanya ada; nilai berulang (`?ubah=a&ubah=b`) diabaikan.
 */
export function bacaBukaAwal(sp: { baru?: string | string[]; ubah?: string | string[] }): BukaAwal | null {
  if (typeof sp.ubah === "string" && sp.ubah.trim() !== "") return { jenis: "ubah", id: sp.ubah.trim() };
  if (sp.baru === "1") return { jenis: "baru" };
  return null;
}

/**
 * Isi awal formulir untuk `buka`, atau null (formulir tertutup). Akun yang
 * tidak ditemukan cukup membuka daftar — tidak ada formulir kosong yang
 * menyamar sebagai akun lain.
 */
export function drafAwal(
  buka: BukaAwal | null,
  pengguna: ReadonlyArray<{ id: string; nama: string; email: string; roleId: string | null; tokoId: string | null }>,
): DrafPengguna | null {
  if (!buka) return null;
  const kosong = { sandi: "", ulangSandi: "" };
  if (buka.jenis === "baru") return { id: null, nama: "", email: "", roleId: "", tokoId: null, ...kosong };
  const u = pengguna.find((p) => p.id === buka.id);
  if (!u) return null;
  return { id: u.id, nama: u.nama, email: u.email, roleId: u.roleId ?? "", tokoId: u.tokoId, ...kosong };
}
