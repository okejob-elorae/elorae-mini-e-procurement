import { spgUnitPrice, type SpgStorePricing } from "./pricing";

/**
 * Harga kasir SPG — murni, tanpa basis data, aman untuk klien.
 *
 * Kasir SPG mencatat harga yang DIBAYAR PEMBELI di toko itu (keputusan pemilik
 * 2026-10-04). Aturannya satu, `spgUnitPrice` (`./pricing`), dipakai penulis
 * nota (`recordSpgSale`), katalog layar jual (pratinjau dan antrean tanpa
 * sinyal membaca harga katalog), dan info produk di HP SPG:
 *   - toko PUTUS: harga jual Elorae (`Item.sellingPrice`) dikurangi diskon harga
 *     toko (`priceDiscountPercent`), lewat `computeStorePrice` PUTUS;
 *   - toko KONSI: harga di toko = harga jual × (1 + markup toko %), lewat
 *     `computeStorePrice` KONSI (75.000 pada markup 25% → 93.750). Promo konter
 *     dan diskon SPG dihitung dari harga ini.
 * Toko konsinyasi dengan markup yang tidak sah (kosong, negatif, di atas batas
 * kolom) TIDAK punya harga kasir (null): penulis nota menolaknya `NO_PRICE`,
 * bukan menjual di harga katalog yang diam-diam terlalu murah.
 *
 * Harga satuan tetap persis sampai sen (markup 12,5%: 112.498,875 → 112.498,88).
 * Yang dibulatkan ke rupiah utuh hanya total nota (`roundToWholeRupiah`) — di
 * penulis nota dan di pratinjau layar jual — karena uang di konter tidak bersen.
 */

export type SyaratHargaToko = SpgStorePricing;

export function hargaKasirSpg(sellingPrice: number | null, toko: SyaratHargaToko): number | null {
  if (sellingPrice === null || !Number.isFinite(sellingPrice)) return null;
  const price = spgUnitPrice(toko, sellingPrice);
  return price !== null && Number.isFinite(price) ? price : null;
}

const persenAtauNull = (nilai: unknown): number | null => {
  const n = nilai === null || nilai === undefined ? null : Number(nilai);
  return n !== null && Number.isFinite(n) ? n : null;
};

/** Baris `Store` (enum + Decimal dari Prisma) → syarat harga. Jenis tak dikenal = PUTUS. */
export function syaratHargaToko(store: { termsType: unknown; markupPercent: unknown; priceDiscountPercent: unknown }): SyaratHargaToko {
  return {
    termsType: store.termsType === "KONSI" ? "KONSI" : "PUTUS",
    markupPercent: persenAtauNull(store.markupPercent),
    priceDiscountPercent: persenAtauNull(store.priceDiscountPercent),
  };
}
