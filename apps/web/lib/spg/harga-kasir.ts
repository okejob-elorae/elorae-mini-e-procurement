import { computeStorePrice } from "@elorae/db/pricing";

/**
 * Harga kasir SPG — murni, tanpa basis data, aman untuk klien.
 *
 * Kasir SPG mencatat harga yang DIBAYAR PEMBELI di toko itu (keputusan pemilik
 * 2026-10-04), satu aturan untuk penulis nota (`recordSpgSale`), katalog layar
 * jual (pratinjau dan antrean tanpa sinyal membaca harga katalog), dan info
 * produk di HP SPG:
 *   - toko PUTUS: harga jual Elorae (`Item.sellingPrice`) dikurangi diskon harga
 *     toko (`priceDiscountPercent`), lewat `computeStorePrice` PUTUS;
 *   - toko KONSI: harga di toko = harga jual × (1 + markup toko %), lewat
 *     `computeStorePrice` KONSI (75.000 pada markup 25% → 93.750). Promo konter
 *     dan diskon SPG dihitung dari harga ini.
 * Markup konsinyasi yang tidak sah (kosong, negatif, di atas batas kolom)
 * mengikuti `computeStorePrice`: harga jual apa adanya.
 *
 * Hasil markup dibulatkan ke rupiah utuh — uang di konter tidak bersen
 * (markup 12,5%: 112.498,875 → 112.499). Harga toko putus tidak dibulatkan,
 * supaya nota toko putus sama persis dengan sebelumnya.
 */

export type SyaratHargaToko = {
  termsType: "PUTUS" | "KONSI";
  markupPercent: number | null;
  priceDiscountPercent: number | null;
};

export function hargaKasirSpg(sellingPrice: number | null, toko: SyaratHargaToko): number | null {
  if (sellingPrice === null || !Number.isFinite(sellingPrice)) return null;
  const { price, flagged } = computeStorePrice({
    sellingPrice,
    termsType: toko.termsType,
    markupPercent: toko.markupPercent,
    priceDiscountPercent: toko.priceDiscountPercent,
  });
  if (price === null || !Number.isFinite(price)) return null;
  // Hanya harga yang benar-benar dinaikkan markup yang dibulatkan.
  return toko.termsType === "KONSI" && !flagged ? Math.round(price) : price;
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
