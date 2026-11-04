import { validasiPengguna, type KodeValidasi } from "@/lib/users/validasi";

export type AlasanBelumSimpan = KodeValidasi | "PERAN_WAJIB" | "MULAI_WAJIB";

/** Urutan isian di formulir — alasan yang disebut adalah yang pertama dari atas. */
const URUTAN: readonly AlasanBelumSimpan[] = [
  "NAMA_WAJIB",
  "EMAIL_TIDAK_VALID",
  "PERAN_WAJIB",
  "TOKO_WAJIB",
  "MULAI_WAJIB",
  "SANDI_WAJIB",
  "SANDI_PENDEK",
  "SANDI_TIDAK_SAMA",
];

/**
 * Keadaan SPG akun yang sedang diubah, dibaca dari daftar pengguna. Akun baru: tanpa tanggal mulai,
 * belum berhenti.
 */
export type AkunSpgTampil = { mulaiTersimpan: string | null; berhenti: string | null };

const AKUN_BARU: AkunSpgTampil = { mulaiTersimpan: null, berhenti: null };

/**
 * Isian pertama yang membuat tombol Simpan mati, atau null bila lengkap.
 * Aturannya sama dengan server (`validasiPengguna` + `simpanPenggunaAction`) ditambah peran wajib:
 * - SPG yang sudah berhenti tidak wajib punya toko tetap (tokonya hanya kembali lewat "Batalkan
 *   berhenti"), jadi juga tidak dimintai tanggal mulai;
 * - peran SPG dengan toko tetap pada akun yang belum punya tanggal mulai wajib membawa "Mulai
 *   bekerja di toko ini" (`MULAI_WAJIB`, B27). Tanggal yang sudah tersimpan tidak diubah dari
 *   formulir ini — lewat tombol "Tanggal mulai" di daftar pengguna.
 */
export function alasanBelumBisaSimpan(
  draf: DrafPengguna,
  peran: { spg: boolean } | undefined,
  akun: AkunSpgTampil = AKUN_BARU,
): AlasanBelumSimpan | null {
  const spg = peran?.spg ?? false;
  const galat: AlasanBelumSimpan[] = validasiPengguna({
    baru: draf.id === null,
    nama: draf.nama,
    email: draf.email,
    sandi: draf.sandi,
    ulangSandi: draf.ulangSandi,
    butuhToko: spg && akun.berhenti === null,
    tokoId: draf.tokoId,
  });
  if (!draf.roleId) galat.push("PERAN_WAJIB");
  if (butuhMulaiSpg(draf, peran, akun) && !draf.mulai.trim()) galat.push("MULAI_WAJIB");
  return URUTAN.find((k) => galat.includes(k)) ?? null;
}

/** Formulir ini meminta "Mulai bekerja di toko ini": peran SPG, toko tetap dipilih, akun belum punya tanggal itu, belum berhenti. */
export function butuhMulaiSpg(draf: Pick<DrafPengguna, "tokoId">, peran: { spg: boolean } | undefined, akun: AkunSpgTampil = AKUN_BARU): boolean {
  return (peran?.spg ?? false) && akun.berhenti === null && draf.tokoId !== null && akun.mulaiTersimpan === null;
}

export type DrafPengguna = {
  id: string | null;
  nama: string;
  email: string;
  roleId: string;
  tokoId: string | null;
  sandi: string;
  ulangSandi: string;
  /** "YYYY-MM-DD" atau kosong — dikirim hanya bila formulir memintanya (`butuhMulaiSpg`). */
  mulai: string;
};

/**
 * Isian untuk `simpanPenggunaAction`. Tanggal mulai dikirim hanya bila formulir memintanya — akun
 * yang sudah punya tanggal itu tidak membawanya (server mengabaikannya juga).
 */
export function muatanSimpan(draf: DrafPengguna, perluMulai: boolean) {
  const { mulai, ...isian } = draf;
  return { ...isian, mulai: perluMulai && mulai.trim() ? mulai.trim() : null };
}

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
  const kosong = { sandi: "", ulangSandi: "", mulai: "" };
  if (buka.jenis === "baru") return { id: null, nama: "", email: "", roleId: "", tokoId: null, ...kosong };
  const u = pengguna.find((p) => p.id === buka.id);
  if (!u) return null;
  return { id: u.id, nama: u.nama, email: u.email, roleId: u.roleId ?? "", tokoId: u.tokoId, ...kosong };
}
