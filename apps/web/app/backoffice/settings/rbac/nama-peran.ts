/**
 * Nama tampilan peran — SATU aturan untuk Pengaturan → Pengguna (daftar dan
 * pemilih peran) dan Pengaturan → Peran & izin (judul kartu, judul dialog,
 * "Mulai dari"). Basis data menyimpan kode (`PRODUCTION`, `ADMIN_PAJAK`);
 * layar tidak pernah menampilkan kode itu mentah.
 *
 * Murni (tanpa Prisma), aman diimpor komponen klien.
 */

/** Peran seed yang punya terjemahan di `settings.users.roleName.<KODE>`. */
export const PERAN_BERNAMA = [
  "ADMIN",
  "PURCHASER",
  "WAREHOUSE",
  "PRODUCTION",
  "SALESMAN",
  "SPG",
  "KEUANGAN",
  "ADMIN_PAJAK",
  "ADMIN_PENJUALAN",
] as const;

export type PeranBernama = (typeof PERAN_BERNAMA)[number];

export function punyaNamaTampil(nama: string): nama is PeranBernama {
  return (PERAN_BERNAMA as readonly string[]).includes(nama);
}

/** Singkatan yang tetap huruf besar saat kode peran dimanusiakan. */
const SINGKATAN = new Set(["SPG", "PO", "PPN", "HPP", "KOL", "GRN", "WO", "CMT", "HR", "IT", "QC", "CS", "PIC", "SFA", "HP"]);

/**
 * Kode peran buatan sendiri ("ADMIN_GUDANG") → "Admin gudang". Nama yang sudah
 * ditulis seperti kalimat ("Manajer toko", "Kasir") tampil apa adanya.
 */
export function manusiakanKodePeran(nama: string): string {
  const bersih = nama.trim();
  if (!/[A-Z]/.test(bersih) || !/^[A-Z0-9_\-\s]+$/.test(bersih)) return bersih;
  return bersih
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((kata, i) => {
      if (SINGKATAN.has(kata)) return kata;
      const kecil = kata.toLowerCase();
      return i === 0 ? kecil.charAt(0).toUpperCase() + kecil.slice(1) : kecil;
    })
    .join(" ");
}

/**
 * Nama peran untuk layar. `terjemah` menerima kode peran bernama dan
 * mengembalikan `settings.users.roleName.<KODE>` dalam bahasa aktif.
 */
export function namaTampilPeran(nama: string, terjemah: (kode: PeranBernama) => string): string {
  return punyaNamaTampil(nama) ? terjemah(nama) : manusiakanKodePeran(nama);
}

/**
 * Urutan peran di pemilih: peran sistem (akses penuh) dulu, lalu menurut nama
 * tampilnya — bukan menurut kode, yang menyebar "Admin pajak" dan
 * "Administrator" jauh dari "Pembelian" begitu kodenya diterjemahkan.
 */
export function urutPeranTampil<T>(peran: readonly T[], nama: (p: T) => string, sistem: (p: T) => boolean): T[] {
  return [...peran].sort(
    (a, b) => Number(sistem(b)) - Number(sistem(a)) || nama(a).localeCompare(nama(b), "id", { sensitivity: "base" }),
  );
}
