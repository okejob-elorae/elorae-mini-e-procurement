import { describe, expect, it } from "vitest";
import { hargaKasirSpg, syaratHargaToko } from "./harga-kasir";

/**
 * Harga yang dicatat kasir SPG = harga yang dibayar pembeli DI toko itu
 * (keputusan pemilik 2026-10-04). Toko konsinyasi: harga di toko (gross-up
 * margin toko), bukan harga putus Elorae.
 */
describe("hargaKasirSpg", () => {
  it("toko putus: harga jual Elorae apa adanya (75.000 → 75.000), margin diabaikan", () => {
    expect(hargaKasirSpg(75_000, { termsType: "PUTUS", marginPercent: null })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "PUTUS", marginPercent: 25 })).toBe(75_000);
    // Harga bersen di master tidak dibulatkan untuk toko putus — perilaku lama tetap.
    expect(hargaKasirSpg(99_900.5, { termsType: "PUTUS", marginPercent: null })).toBe(99_900.5);
  });

  it("toko konsinyasi margin 25%: 75.000 / (1 − 25%) = 100.000", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", marginPercent: 25 })).toBe(100_000);
  });

  it("toko konsinyasi margin 30%: 75.000 / 0,7 = 107.142,857… dibulatkan ke rupiah utuh 107.143", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", marginPercent: 30 })).toBe(107_143);
  });

  it("margin tidak sah (kosong, negatif, ≥ 100) diperlakukan sama dengan computeStorePrice: harga jual apa adanya", () => {
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", marginPercent: null })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", marginPercent: -5 })).toBe(75_000);
    expect(hargaKasirSpg(75_000, { termsType: "KONSI", marginPercent: 100 })).toBe(75_000);
  });

  it("barang tanpa harga jual tidak punya harga kasir", () => {
    expect(hargaKasirSpg(null, { termsType: "KONSI", marginPercent: 25 })).toBeNull();
    expect(hargaKasirSpg(null, { termsType: "PUTUS", marginPercent: null })).toBeNull();
  });
});

describe("syaratHargaToko", () => {
  it("membaca bentuk Prisma: margin Decimal/teks → angka, kosong → null", () => {
    expect(syaratHargaToko({ termsType: "KONSI", marginPercent: "25.00" })).toEqual({ termsType: "KONSI", marginPercent: 25 });
    expect(syaratHargaToko({ termsType: "PUTUS", marginPercent: null })).toEqual({ termsType: "PUTUS", marginPercent: null });
  });

  it("jenis yang tidak dikenal jatuh ke PUTUS (harga jual apa adanya), bukan gross-up", () => {
    expect(syaratHargaToko({ termsType: "LAIN", marginPercent: 25 })).toEqual({ termsType: "PUTUS", marginPercent: 25 });
  });
});
