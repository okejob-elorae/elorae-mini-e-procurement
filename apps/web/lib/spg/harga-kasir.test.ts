import { describe, expect, it } from "vitest";
import { hargaKasirSpg, syaratHargaToko } from "./harga-kasir";

/**
 * Harga yang dicatat kasir SPG = harga yang dibayar pembeli DI toko itu
 * (keputusan pemilik 2026-10-04). Toko konsinyasi: harga di toko (markup toko),
 * bukan harga putus Elorae.
 */
describe("hargaKasirSpg", () => {
  it("toko putus tanpa diskon: harga jual Elorae apa adanya (75.000 → 75.000), markup diabaikan", () => {
    expect(hargaKasirSpg(75_000, { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "PUTUS", markupPercent: 25, priceDiscountPercent: null })).toBe(75_000);
    // Harga bersen di master tidak dibulatkan untuk toko putus — perilaku lama tetap.
    expect(hargaKasirSpg(99_900.5, { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null })).toBe(99_900.5);
  });

  it("toko putus dengan diskon harga toko 10%: 75.000 → 67.500", () => {
    expect(hargaKasirSpg(75_000, { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: 10 })).toBe(67_500);
  });

  it("toko konsinyasi markup 25%: 75.000 × (1 + 25%) = 93.750", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: 25, priceDiscountPercent: null })).toBe(93_750);
  });

  it("toko konsinyasi markup 12,5%: 99.999 × 1,125 = 112.498,875 dibulatkan ke rupiah utuh 112.499", () => {
    expect(hargaKasirSpg(99_999, { termsType: "KONSI", markupPercent: 12.5, priceDiscountPercent: null })).toBe(112_499);
  });

  it("toko konsinyasi mengabaikan diskon harga toko", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: 25, priceDiscountPercent: 10 })).toBe(93_750);
  });

  it("markup 100% sah: 75.000 → 150.000", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: 100, priceDiscountPercent: null })).toBe(150_000);
  });

  it("markup tidak sah (kosong, negatif, di atas batas) diperlakukan sama dengan computeStorePrice: harga jual apa adanya", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: null, priceDiscountPercent: null })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: -5, priceDiscountPercent: null })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", markupPercent: 1000, priceDiscountPercent: null })).toBe(75_000);
  });

  it("barang tanpa harga jual tidak punya harga kasir", () => {
    expect(hargaKasirSpg(null, { termsType: "KONSI", markupPercent: 25, priceDiscountPercent: null })).toBeNull();
    expect(hargaKasirSpg(null, { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null })).toBeNull();
  });
});

describe("syaratHargaToko", () => {
  it("membaca bentuk Prisma: markup/diskon Decimal/teks → angka, kosong → null", () => {
    expect(syaratHargaToko({ termsType: "KONSI", markupPercent: "25.00", priceDiscountPercent: null })).toEqual({
      termsType: "KONSI",
      markupPercent: 25,
      priceDiscountPercent: null,
    });
    expect(syaratHargaToko({ termsType: "PUTUS", markupPercent: null, priceDiscountPercent: "7.50" })).toEqual({
      termsType: "PUTUS",
      markupPercent: null,
      priceDiscountPercent: 7.5,
    });
  });

  it("jenis yang tidak dikenal jatuh ke PUTUS (harga jual apa adanya), bukan markup", () => {
    expect(syaratHargaToko({ termsType: "LAIN", markupPercent: 25, priceDiscountPercent: null })).toEqual({
      termsType: "PUTUS",
      markupPercent: 25,
      priceDiscountPercent: null,
    });
  });
});
