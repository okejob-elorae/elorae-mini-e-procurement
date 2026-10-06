import { pwaDb } from "./db";
import { KUNCI_ATURAN_KUNJUNGAN, KUNCI_KUNJUNGAN_TERKIRIM } from "./luring-kunjungan";
import { KUNCI_FOTO_TERKIRIM } from "./foto-kunjungan";

/**
 * Hapus semua jejak salesman dari HP ini: antrean kiriman dan halaman tersimpan.
 *
 * Dipanggil saat keluar. Tanpa ini, HP yang dipakai bergantian menyimpan
 * pesanan, foto, dan halaman toko salesman sebelumnya untuk salesman berikutnya.
 * Nota SPG yang belum terkirim ikut terhapus — karena itu `TombolKeluar`
 * menghitungnya dulu (`hitungBelumTerkirim`) dan meminta persetujuan; jangan
 * panggil fungsi ini tanpa langkah itu. Catatan selisih total nota SPG
 * (`localStorage`, lihat `spg-jual-selisih.ts`) dan keranjang jual SPG yang
 * belum disimpan (`sessionStorage`, bisa berisi nama dan HP pembeli) ikut
 * dihapus: isinya data orang ini. Begitu juga check-in, check-out,
 * pekerjaan stok, dan mutasi antar toko yang dicatat tanpa sinyal — basis
 * data antrean dihapus utuh, jadi tabel baru ikut tanpa didaftarkan — ikut terhitung oleh
 * `hitungBelumTerkirim` sebelum dihapus.
 *
 * Cache PRECACHE Service Worker sengaja DIBIARKAN: isinya kerangka aplikasi dan
 * halaman offline, bukan data siapa pun, dan menghapusnya membuat aplikasi tidak
 * bisa dibuka tanpa sinyal sampai SW dipasang ulang. Cache lainnya (halaman,
 * katalog, respons API) berisi data orang ini, jadi dihapus semua.
 */
export async function bersihkanDataPerangkat(): Promise<void> {
  await pwaDb.delete();
  hapusSimpananSpg();
  if (typeof caches === "undefined") return;
  const nama = await caches.keys();
  await Promise.all(nama.filter((n) => !n.includes("precache")).map((n) => caches.delete(n)));
}

/**
 * Awalan kunci simpanan peramban milik orang ini: layar jual SPG (lihat
 * `app/pwa/spg/sale/keranjang.ts`, `spg-jual-selisih.ts`) dan kunjungan tanpa
 * sinyal (`luring-kunjungan.ts`: kunjungan yang berjalan di HP dan aturan
 * check-out orang ini). Kunjungan orang sebelumnya tidak boleh terbaca
 * "sedang berjalan" oleh orang berikutnya di HP yang sama.
 */
const AWALAN_SIMPANAN_SPG = [
  "elorae.spg.keranjang.",
  "elorae.spg.selisihTotal",
  // Keranjang jual van yang hasilnya belum pasti (`AWALAN_SIMPANAN_KERANJANG_VAN`,
  // app/pwa/van/keranjang.ts) — terikat userId, tapi tidak boleh tertinggal di tab.
  "elorae.van.keranjang.",
  KUNCI_KUNJUNGAN_TERKIRIM,
  // Juga menutup penanda "sudah dimuat sesi ini" (`…aturanKunjungan.dimuat`,
  // sessionStorage), supaya orang berikutnya di tab yang sama memuat aturannya sendiri.
  KUNCI_ATURAN_KUNJUNGAN,
  // Jumlah foto kunjungan yang sudah sampai ke server (aturan wajib foto tanpa sinyal).
  KUNCI_FOTO_TERKIRIM,
];

function hapusSimpananSpg(): void {
  if (typeof window === "undefined") return;
  for (const ambil of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      const s = ambil();
      const kunci: string[] = [];
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        if (k && AWALAN_SIMPANAN_SPG.some((a) => k.startsWith(a))) kunci.push(k);
      }
      for (const k of kunci) s.removeItem(k);
    } catch {
      // Penyimpanan dilarang (mode privat): tidak ada yang perlu dihapus.
    }
  }
}
