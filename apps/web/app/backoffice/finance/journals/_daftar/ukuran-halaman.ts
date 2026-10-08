/*
 * Ukuran halaman daftar Jurnal dan buku besar (`?per=`). Audit G8: 10 baris per
 * halaman membuat 557 jurnal menjadi 56 halaman. Murni, aman untuk klien.
 */

export const PILIHAN_UKURAN_HALAMAN = [25, 50, 100] as const;
export const UKURAN_HALAMAN_BAWAAN = 25;

export function bacaUkuranHalaman(v: string | null | undefined): number {
  const n = Number(v);
  return (PILIHAN_UKURAN_HALAMAN as readonly number[]).includes(n) ? n : UKURAN_HALAMAN_BAWAAN;
}

/** Potong daftar yang sudah dimuat utuh (buku besar: saldo berjalan butuh semua baris) menjadi satu halaman. */
export function halamanBaris<T>(rows: T[], halaman: number, per: number): { baris: T[]; halaman: number; jumlahHalaman: number } {
  const jumlahHalaman = Math.max(1, Math.ceil(rows.length / per));
  const h = Math.min(Math.max(1, Math.trunc(halaman) || 1), jumlahHalaman);
  return { baris: rows.slice((h - 1) * per, h * per), halaman: h, jumlahHalaman };
}
