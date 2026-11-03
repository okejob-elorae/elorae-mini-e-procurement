import { computeStorePrice } from "@elorae/db/pricing";

/**
 * Nilai konsinyasi di HP SALESMAN — murni, aman di klien.
 *
 * Pemilik P18 (2026-11-02): "berikan selengkapnya saja, tidak masalah jika kelihatan nama toko,
 * pcs dan nominalnya juga" — HP salesman menampilkan konsi lengkap, pesanan maupun tagihan. P18a:
 * hanya HP salesman; HP SPG dan portal toko tetap tanpa harga konsi.
 *
 * Selama pesanan konsi MENUNGGU persetujuan belum ada harga yang dibekukan (kantor membekukannya
 * saat menyetujui, dengan rumus yang sama), jadi HP menampilkan PERKIRAAN: harga retail toko
 * sekarang = harga jual barang × (1 + markup toko), `computeStorePrice` KONSI — satu rumus untuk
 * katalog, rencana kirim, stok di toko dan pesanan.
 */

/**
 * Harga retail konsi satu barang di toko ini untuk HP salesman. `null` bila barang belum berharga
 * atau markup toko kosong / di luar batas (`flagged`): perkiraan tidak boleh diam-diam memakai
 * harga katalog.
 */
export function hargaKonsiHp(sellingPrice: number | null, markupPercent: number | null): number | null {
  const harga = computeStorePrice({ sellingPrice, termsType: "KONSI", markupPercent, priceDiscountPercent: null });
  if (harga.flagged || harga.price === null) return null;
  return harga.price;
}

/**
 * Perkiraan nilai sekumpulan baris konsi. `lengkap` false bila ada baris yang belum berharga —
 * layar menyebutnya, supaya angka sebagian tidak dibaca sebagai total.
 */
export type PerkiraanKonsi = { nilai: number; lengkap: boolean };

/**
 * Jumlah qty × harga dalam sen bulat (tanpa galat pecahan). `null` bila tidak satu baris pun
 * berharga — tidak ada angka yang bisa ditampilkan.
 */
export function perkiraanNilaiKonsi(baris: readonly { qty: number; harga: number | null }[]): PerkiraanKonsi | null {
  let sen = 0;
  let adaHarga = false;
  let lengkap = true;
  for (const b of baris) {
    if (b.harga === null || !Number.isFinite(b.harga)) {
      if (b.qty !== 0) lengkap = false;
      continue;
    }
    adaHarga = true;
    sen += Math.round(b.qty * Math.round(b.harga * 100));
  }
  if (!adaHarga) return null;
  return { nilai: sen / 100, lengkap };
}
