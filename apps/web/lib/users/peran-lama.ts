import type { Role } from "@/lib/constants/enums";

/**
 * "Peran lama" — kolom `User.role` (ADMIN / PURCHASER / WAREHOUSE / PRODUCTION /
 * USER) — TIDAK pernah dipilih orang. Ia selalu diturunkan dari peran baru
 * (`RoleDefinition`) dengan aturan di bawah. Murni, dites.
 *
 * Kolom itu sisa sebelum ada manajemen peran, tetapi beberapa layar masih
 * membacanya lewat `session.user.role` (tab HPP Work Order, markup HPP,
 * laporan HPP, menu khusus admin). Dulu hanya Akun Profil (versi tim) yang
 * mengisinya, dan dari NAMA peran; Pengaturan → Pengguna tidak mengisinya sama
 * sekali. Akibatnya orang yang diangkat menjadi admin lewat Pengguna tetap USER
 * di kolom lama — tidak bisa membuka Peran & izin dan tab HPP — dan admin yang
 * diturunkan lewat Pengguna tetap ADMIN di sana.
 *
 * Pekerjaan tanpa orang (cron, skrip) yang butuh pelaku harus memilihnya lewat
 * `adminSistemTertua` di lib/users/admin-sistem.ts, bukan dari kolom ini —
 * sapuan jurnal, jurnal berulang, penyusutan aset, jurnal penjualan, dan skrip
 * stok awal pernah membacanya langsung di basis data.
 *
 * ADMIN di sini = peran SISTEM (izin penuh `*`), aturan yang sama dengan
 * wildcard di lib/auth/segarkan-sesi.ts — bukan peran yang kebetulan bernama
 * "ADMIN". Peran lain yang namanya persis salah satu peran lama mendapat nama
 * itu (aturan Akun Profil dulu); selebihnya USER.
 */
const PERAN_LAMA_BERNAMA: ReadonlySet<string> = new Set(["PURCHASER", "WAREHOUSE", "PRODUCTION"] satisfies Role[]);

export function peranLamaDari(peran: { name?: string | null; isSystem: boolean } | null | undefined): Role {
  if (!peran) return "USER";
  if (peran.isSystem) return "ADMIN";
  const nama = peran.name ?? "";
  return PERAN_LAMA_BERNAMA.has(nama) ? (nama as Role) : "USER";
}

/**
 * Peran lama untuk SESI, dari isi sesi yang sudah dibaca dari peran baru:
 * `permissions` berisi `*` tepat bila perannya peran sistem (tidak ada baris
 * izin bernama `*`, jadi peran biasa tidak bisa membawanya).
 *
 * Dipakai lib/auth.ts supaya `session.user.role` mengikuti peran baru walau
 * kolom `User.role` orang itu masih basi dari sebelum Pengguna ikut
 * mengisinya — tanpa migrasi, dan tanpa menyentuh setiap layar yang membacanya.
 */
export function peranLamaSesi(isi: { roleName?: string | null; permissions?: readonly string[] | null }): Role {
  return peranLamaDari({ name: isi.roleName, isSystem: (isi.permissions ?? []).includes("*") });
}
