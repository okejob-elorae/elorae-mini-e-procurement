import { pwaDb } from "./db";

/** Nama peristiwa yang ditembakkan setiap kali antrean HP mungkin berubah. */
export const PERISTIWA_ANTREAN = "elorae:antrean";

/**
 * Semua kiriman yang masih tertahan di HP ini, dari tabel mana pun.
 *
 * Satu angka untuk satu pertanyaan salesman: "masih ada yang belum sampai ke
 * kantor?" — dipakai titik di menu, tugas di beranda, dan peringatan sebelum
 * keluar. Menghitung SEMUA tabel basis data antrean, jadi jenis antrean baru
 * ikut terhitung tanpa perlu didaftarkan di sini — termasuk nota SPG yang
 * dijual tanpa sinyal (`pendingSpgSales`), sehingga keluar akun tidak pernah
 * membuang nota penjualan tanpa peringatan — dan check-in, check-out, serta
 * pekerjaan stok SPG yang dicatat tanpa sinyal (versi 7), serta mutasi antar
 * toko yang diajukan atau ditandai dikirim tanpa sinyal (versi 8). Karena itu basis
 * data ini HANYA berisi antrean: tabel lain (cache, catatan) akan terhitung
 * "belum terkirim". Kunjungan yang sudah terkirim tapi masih "berjalan" di HP
 * disimpan di `localStorage` (`luring-kunjungan.ts`), bukan di sini.
 */
export async function hitungBelumTerkirim(): Promise<number> {
  const jumlah = await Promise.all(pwaDb.tables.map((tabel) => tabel.count()));
  return jumlah.reduce((a, b) => a + b, 0);
}
