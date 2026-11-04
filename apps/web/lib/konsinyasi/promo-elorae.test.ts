import { describe, expect, it } from "vitest";
import { bagianEloraeSen, bagianKembaliSen, hitungPromoElorae, totalTagihanKonsi } from "./promo-elorae";

describe("bagian Elorae dari potongan promo", () => {
  it("contoh pemilik: promo 20% penuh Elorae → tagihan berkurang 20.000", () => {
    // Harga 100.000, margin toko 30% → laku resmi 70.000.
    const r = hitungPromoElorae({ jual: [{ qty: 1, discount: 20_000, storeDiscount: 0 }], kembali: [] });
    expect(r.total).toBe(20_000);
    expect(totalTagihanKonsi({ lakuResmi: 70_000, promoElorae: r.total, bebanHilang: 0 })).toBe(50_000);
  });

  it("contoh pemilik: promo dibagi 50:50 → tagihan berkurang 10.000", () => {
    const r = hitungPromoElorae({ jual: [{ qty: 1, discount: 20_000, storeDiscount: 10_000 }], kembali: [] });
    expect(r.total).toBe(10_000);
    expect(totalTagihanKonsi({ lakuResmi: 70_000, promoElorae: r.total, bebanHilang: 0 })).toBe(60_000);
  });

  it("bagian toko penuh tidak mengubah tagihan", () => {
    expect(bagianEloraeSen({ discount: 15_000, storeDiscount: 15_000 })).toBe(0);
  });

  it("beban barang hilang ke toko menambah tagihan", () => {
    expect(totalTagihanKonsi({ lakuResmi: 70_000, promoElorae: 20_000, bebanHilang: 35_000.5 })).toBe(85_000.5);
  });
});

describe("potong yang dikembalikan pembeli", () => {
  it("mengembalikan bagian Elorae per potong", () => {
    // 3 potong, bagian Elorae 30.000 → satu potong kembali = 10.000.
    const r = hitungPromoElorae({
      jual: [],
      kembali: [{ qty: 3, discount: 30_000, storeDiscount: 0, qtySebelum: 0, qtyKembali: 1 }],
    });
    expect(r).toEqual({ dariJual: 0, dikembalikan: 10_000, total: -10_000 });
  });

  it("retur bertahap dihitung kumulatif: semua kembali = seluruh potongan, tanpa sisa sen", () => {
    const baris = { qty: 3, discount: 100, storeDiscount: 0 };
    const tiga = [0, 1, 2].map((sebelum) => bagianKembaliSen({ ...baris, qtySebelum: sebelum, qtyKembali: 1 }));
    expect(tiga.reduce((s, x) => s + x, 0)).toBe(bagianEloraeSen(baris));
  });

  it("tidak pernah mengembalikan lebih dari potong yang dijual", () => {
    const b = { qty: 2, discount: 40_000, storeDiscount: 10_000, qtySebelum: 1, qtyKembali: 5 };
    expect(bagianKembaliSen(b)).toBe(1_500_000);
  });

  it("nota dan retur di bulan yang sama saling mengurangi", () => {
    const r = hitungPromoElorae({
      jual: [
        { qty: 2, discount: 40_000, storeDiscount: 0 },
        { qty: 1, discount: 10_000, storeDiscount: 5_000 },
      ],
      kembali: [{ qty: 2, discount: 40_000, storeDiscount: 0, qtySebelum: 0, qtyKembali: 1 }],
    });
    expect(r).toEqual({ dariJual: 45_000, dikembalikan: 20_000, total: 25_000 });
  });
});
