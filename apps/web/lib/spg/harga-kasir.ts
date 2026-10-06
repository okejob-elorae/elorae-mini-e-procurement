import { computeStorePrice } from "@elorae/db/pricing";

/**
 * Harga kasir SPG — murni, tanpa basis data, aman untuk klien.
 *
 * Kasir SPG mencatat harga yang DIBAYAR PEMBELI di toko itu (keputusan pemilik
 * 2026-10-04), satu aturan untuk penulis nota (`recordSpgSale`), katalog layar
 * jual (pratinjau dan antrean tanpa sinyal membaca harga katalog), dan info
 * produk di HP SPG:
 *   - toko PUTUS: harga jual Elorae (`Item.sellingPrice`) apa adanya;
 *   - toko KONSI: harga di toko = harga jual ÷ (1 − margin toko %), lewat
 *     `computeStorePrice` KONSI (75.000 pada margin 25% → 100.000). Promo konter
 *     dan diskon SPG dihitung dari harga ini.
 * Margin konsinyasi yang tidak sah (kosong, negatif, ≥ 100) mengikuti
 * `computeStorePrice`: harga jual apa adanya.
 *
 * Hasil gross-up dibulatkan ke rupiah utuh — uang di konter tidak bersen
 * (margin 30%: 107.142,857… → 107.143). Harga toko putus tidak dibulatkan,
 * supaya nota toko putus sama persis dengan sebelumnya.
 */

export type SyaratHargaToko = { termsType: "PUTUS" | "KONSI"; marginPercent: number | null };

export function hargaKasirSpg(sellingPrice: number | null, toko: SyaratHargaToko): number | null {
  if (sellingPrice === null || !Number.isFinite(sellingPrice)) return null;
  const { price, flagged } = computeStorePrice({ sellingPrice, termsType: toko.termsType, marginPercent: toko.marginPercent });
  if (price === null || !Number.isFinite(price)) return null;
  // Hanya harga yang benar-benar dinaikkan margin yang dibulatkan.
  return toko.termsType === "KONSI" && !flagged ? Math.round(price) : price;
}

/** Baris `Store` (enum + Decimal dari Prisma) → syarat harga. Jenis tak dikenal = PUTUS. */
export function syaratHargaToko(store: { termsType: unknown; marginPercent: unknown }): SyaratHargaToko {
  const m = store.marginPercent === null || store.marginPercent === undefined ? null : Number(store.marginPercent);
  return {
    termsType: store.termsType === "KONSI" ? "KONSI" : "PUTUS",
    marginPercent: m !== null && Number.isFinite(m) ? m : null,
  };
}
