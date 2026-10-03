/**
 * Potongan promo konter yang DITANGGUNG ELORAE di toko konsinyasi — murni,
 * tanpa basis data.
 *
 * Keputusan pemilik 2026-10-03: potongan promo di konter toko konsinyasi bisa
 * ditanggung penuh Elorae atau dibagi dengan toko. Bagian toko dibekukan per
 * baris nota di `SpgSaleLine.storeDiscount` (oleh penulis nota, dari mesin
 * `hitungPromoKonter`); bagian Elorae = `discount − storeDiscount`.
 *
 * Bagian Elorae MENGURANGI tagihan ke toko; bagian toko mengurangi margin toko
 * sendiri dan tidak mengubah tagihan. Contoh pemilik: harga 100.000, margin
 * toko 30% → toko membayar 70.000. Promo 20% ditanggung penuh Elorae → toko
 * membayar 50.000 (tagihan berkurang 20.000). Dibagi 50:50 → toko membayar
 * 60.000 (tagihan berkurang 10.000, margin toko sendiri turun 10.000).
 *
 * Bulan: nota menurut waktu jualnya, potong yang dikembalikan pembeli menurut
 * tanggal returnya — sama dengan bahan laporan SPG (`laporan-spg.ts`). Jadi
 * potongan yang dikembalikan jatuh di bulan yang sama dengan potong yang
 * berkurang dari laku, dan bulan yang sudah dikunci tidak berubah oleh retur
 * sesudahnya.
 *
 * Potong yang dikembalikan mengembalikan bagian Elorae baris itu PER POTONG.
 * Retur bertahap dihitung KUMULATIF — round(bagian × sesudah / qty) −
 * round(bagian × sebelum / qty) — sehingga baris yang akhirnya dikembalikan
 * semua mengembalikan tepat seluruh potongannya, tanpa sen yang tertinggal.
 *
 * Semua hitungan dalam SEN (bilangan bulat).
 */

export type BarisJualPromo = { qty: number; discount: number; storeDiscount: number };

/** Satu baris retur pembeli: baris nota asalnya + berapa potong yang sudah kembali sebelumnya. */
export type BarisKembaliPromo = BarisJualPromo & { qtySebelum: number; qtyKembali: number };

export type HasilPromoElorae = {
  /** Σ bagian Elorae dari nota bulan ini (rupiah). */
  dariJual: number;
  /** Bagian Elorae dari potong yang dikembalikan pembeli bulan ini (rupiah, positif). */
  dikembalikan: number;
  /** dariJual − dikembalikan (rupiah). Boleh negatif kalau bulan itu hanya berisi retur. */
  total: number;
};

export const keSen = (rupiah: number): number => Math.round(rupiah * 100);
const keRupiah = (sen: number): number => sen / 100;

/** Bagian Elorae satu baris nota, dalam sen. */
export function bagianEloraeSen(b: { discount: number; storeDiscount: number }): number {
  return keSen(b.discount) - keSen(b.storeDiscount);
}

/** Bagian Elorae yang kembali bersama potong yang dikembalikan pembeli, dalam sen. */
export function bagianKembaliSen(b: BarisKembaliPromo): number {
  if (b.qty <= 0 || b.qtyKembali <= 0) return 0;
  const jepit = (n: number) => Math.min(Math.max(n, 0), b.qty);
  const sebelum = jepit(b.qtySebelum);
  const sesudah = jepit(b.qtySebelum + b.qtyKembali);
  const bagian = bagianEloraeSen(b);
  return Math.round((bagian * sesudah) / b.qty) - Math.round((bagian * sebelum) / b.qty);
}

export function hitungPromoElorae(input: { jual: BarisJualPromo[]; kembali: BarisKembaliPromo[] }): HasilPromoElorae {
  const jualSen = input.jual.reduce((s, b) => s + bagianEloraeSen(b), 0);
  const kembaliSen = input.kembali.reduce((s, b) => s + bagianKembaliSen(b), 0);
  return { dariJual: keRupiah(jualSen), dikembalikan: keRupiah(kembaliSen), total: keRupiah(jualSen - kembaliSen) };
}

/**
 * Total tagihan siklus ke toko = laku resmi − potongan promo ditanggung Elorae
 * + beban barang hilang yang ditetapkan ke toko. Dihitung dalam sen.
 */
export function totalTagihanKonsi(input: { lakuResmi: number; promoElorae: number; bebanHilang: number }): number {
  return keRupiah(keSen(input.lakuResmi) - keSen(input.promoElorae) + keSen(input.bebanHilang));
}
