import { describe, expect, it } from "vitest";
import { totalUtangBelumDibayar, utangBaris } from "./nilai-utang";

/*
 * Register pembayaran pemasok dulu menjumlahkan total PO penuh sebagai "belum
 * dibayar", padahal PO yang ditutup sebelum lengkap (sisa tidak akan datang)
 * dan PO yang barangnya diretur ke pemasok tidak lagi diutangi sebesar itu.
 * `listPOs` sudah membawa `utang` per baris; register memakainya.
 */
describe("utangBaris", () => {
  it("memakai utang dari listPOs (sesudah Tutup PO dan retur pemasok), bukan total PO", () => {
    expect(utangBaris({ grandTotal: "11100000", utang: { utang: 6_660_000 } })).toBe(6_660_000);
  });

  it("utang 0 (seluruh barang diretur) tetap 0, tidak jatuh ke total PO", () => {
    expect(utangBaris({ grandTotal: 2_220_000, utang: { utang: 0 } })).toBe(0);
  });

  it("baris tanpa utang → total PO", () => {
    expect(utangBaris({ grandTotal: "5000000.50" })).toBe(5_000_000.5);
    expect(utangBaris({ grandTotal: 1_000, utang: null })).toBe(1_000);
  });
});

describe("totalUtangBelumDibayar", () => {
  it("menjumlahkan utang PO yang belum dibayar saja: 6.660.000 + 1.665.000 = 8.325.000", () => {
    expect(
      totalUtangBelumDibayar([
        { paidAt: null, utang: 6_660_000 },
        { paidAt: null, utang: 1_665_000 },
        { paidAt: new Date("2026-10-01"), utang: 5_000_000 },
      ]),
    ).toBe(8_325_000);
  });

  it("dijumlah dalam sen: 0,10 + 0,20 = 0,30 tepat", () => {
    expect(totalUtangBelumDibayar([{ paidAt: null, utang: 0.1 }, { paidAt: null, utang: 0.2 }])).toBe(0.3);
  });

  it("daftar kosong → 0", () => {
    expect(totalUtangBelumDibayar([])).toBe(0);
  });
});
