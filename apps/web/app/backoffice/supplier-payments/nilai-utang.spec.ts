import { describe, expect, it } from "vitest";
import { pisahUtangPo, ringkasUtangBelumDibayar, totalUtangBelumDibayar, utangBaris } from "./nilai-utang";

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

/*
 * Register dulu menjumlah seluruh nilai PO yang belum dibayar sebagai "sisa
 * tagihan", termasuk PO yang barangnya belum datang sama sekali (PO/2026/0001
 * Rp 5.000.000, diterima 0/150). Utang baru ada untuk barang yang sudah
 * diterima; sisanya komitmen PO.
 */
describe("pisahUtangPo", () => {
  const po = (items: Array<{ qty: number; receivedQty: number; price: number; ppnIncluded?: boolean }>, extra: Partial<{ ppnRatePercent: number | null; utang: { utang: number; kreditRetur: number } }> = {}) => ({
    grandTotal: 0,
    ppnRatePercent: extra.ppnRatePercent ?? null,
    utang: extra.utang,
    items: items.map((l) => ({ ...l, ppnIncluded: l.ppnIncluded ?? true })),
  });

  it("belum ada barang diterima: utang 0, seluruh nilai PO komitmen", () => {
    expect(pisahUtangPo(po([{ qty: 150, receivedQty: 0, price: 33_333.33 }], { utang: { utang: 5_000_000, kreditRetur: 0 } }))).toEqual({
      utangDiterima: 0,
      komitmen: 5_000_000,
    });
  });

  it("diterima 50 dari 100 @ 17.000: utang 850.000, komitmen 850.000", () => {
    expect(pisahUtangPo(po([{ qty: 100, receivedQty: 50, price: 17_000 }], { utang: { utang: 1_700_000, kreditRetur: 0 } }))).toEqual({
      utangDiterima: 850_000,
      komitmen: 850_000,
    });
  });

  it("baris Exclude PPN 11%: utang barang diterima ikut PPN-nya", () => {
    // 10 × 100.000 = 1.000.000 + PPN 110.000; PO 20 × 100.000 + PPN = 2.220.000
    expect(
      pisahUtangPo(
        po([{ qty: 20, receivedQty: 10, price: 100_000, ppnIncluded: false }], {
          ppnRatePercent: 11,
          utang: { utang: 2_220_000, kreditRetur: 0 },
        }),
      ),
    ).toEqual({ utangDiterima: 1_110_000, komitmen: 1_110_000 });
  });

  it("kredit retur pemasok mengurangi utang barang diterima", () => {
    expect(pisahUtangPo(po([{ qty: 100, receivedQty: 100, price: 10_000 }], { utang: { utang: 900_000, kreditRetur: 100_000 } }))).toEqual({
      utangDiterima: 900_000,
      komitmen: 0,
    });
  });

  it("baris tanpa rincian utang memakai total PO", () => {
    expect(pisahUtangPo({ grandTotal: 300_000, ppnRatePercent: null, items: [{ qty: 3, receivedQty: 1, price: 100_000, ppnIncluded: true }] })).toEqual({
      utangDiterima: 100_000,
      komitmen: 200_000,
    });
  });
});

describe("ringkasUtangBelumDibayar", () => {
  it("hanya PO belum dibayar; menghitung PO per kelompok", () => {
    expect(
      ringkasUtangBelumDibayar([
        { paidAt: null, utangDiterima: 850_000, komitmen: 850_000 },
        { paidAt: null, utangDiterima: 0, komitmen: 5_000_000 },
        { paidAt: new Date("2026-10-01"), utangDiterima: 1_000_000, komitmen: 0 },
      ]),
    ).toEqual({ utangDiterima: 850_000, jumlahPoUtang: 1, komitmen: 5_850_000, jumlahPoKomitmen: 2 });
  });

  it("dijumlah dalam sen", () => {
    expect(ringkasUtangBelumDibayar([{ paidAt: null, utangDiterima: 0.1, komitmen: 0.2 }, { paidAt: null, utangDiterima: 0.2, komitmen: 0.1 }])).toEqual({
      utangDiterima: 0.3,
      jumlahPoUtang: 2,
      komitmen: 0.3,
      jumlahPoKomitmen: 2,
    });
  });
});
