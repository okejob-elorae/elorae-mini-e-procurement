/**
 * Ke mana setiap rute Akun Profil yang sudah ditutup diteruskan. Murni, dites.
 *
 * - daftar akun        → Pengaturan → Pengguna
 * - buat akun          → Pengguna, dengan formulir tambah terbuka (`?baru=1`)
 * - ubah akun <id>     → Pengguna, dengan formulir akun itu terbuka (`?ubah=<id>`)
 * - peran (tab / ubah) → Pengaturan → Peran & izin
 */
export type RuteAkunProfil =
  | { jenis: "daftar" }
  | { jenis: "baru" }
  | { jenis: "ubah"; id: string }
  | { jenis: "peran" };

export const HALAMAN_PENGGUNA = "/backoffice/settings/users";
export const HALAMAN_PERAN = "/backoffice/settings/rbac";

export function tujuanAkunProfil(rute: RuteAkunProfil): string {
  switch (rute.jenis) {
    case "daftar":
      return HALAMAN_PENGGUNA;
    case "baru":
      return `${HALAMAN_PENGGUNA}?baru=1`;
    case "ubah":
      return rute.id ? `${HALAMAN_PENGGUNA}?ubah=${encodeURIComponent(rute.id)}` : HALAMAN_PENGGUNA;
    case "peran":
      return HALAMAN_PERAN;
  }
}
