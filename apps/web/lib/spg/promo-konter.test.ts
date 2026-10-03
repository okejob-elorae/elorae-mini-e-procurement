import { describe, expect, it } from "vitest";
import {
  bagiSisaTerbesar,
  hitungPromoKonter,
  periksaPromoKonter,
  potonganSatuan,
  ringkasPromoKonter,
  type BarisKeranjangPromo,
  type PromoKonter,
} from "./promo-konter";

const WAKTU = new Date("2026-10-03T05:00:00Z");

function promo(p: Partial<PromoKonter> & Pick<PromoKonter, "id" | "type">): PromoKonter {
  return {
    name: p.id,
    value: null,
    buyQty: null,
    freeQty: null,
    minSubtotal: null,
    allItems: true,
    itemIds: [],
    categoryIds: [],
    allStores: true,
    storeIds: [],
    startsAt: null,
    endsAt: null,
    priority: 0,
    isActive: true,
    ...p,
  };
}

const baris = (key: string, unitPrice: number, qty: number, extra: Partial<BarisKeranjangPromo> = {}): BarisKeranjangPromo => ({
  key,
  itemId: extra.itemId ?? key,
  categoryId: extra.categoryId ?? null,
  qty,
  unitPrice,
});

function hitung(b: BarisKeranjangPromo[], promos: PromoKonter[], ekstra: Partial<Parameters<typeof hitungPromoKonter>[0]> = {}) {
  const h = hitungPromoKonter({ baris: b, promos, storeId: "toko-1", waktu: WAKTU, ...ekstra });
  if (!h.ok) throw new Error(h.code);
  return h;
}

describe("tanpa promo", () => {
  it("returns the gross total untouched", () => {
    const h = hitung([baris("a", 100_000, 2), baris("b", 50_000, 1)], []);
    expect(h.subtotal).toBe(250_000);
    expect(h.total).toBe(250_000);
    expect(h.potonganTotal).toBe(0);
    expect(h.baris.map((x) => x.bersih)).toEqual([200_000, 50_000]);
  });
});

describe("promo barang", () => {
  it("applies a percentage, rounded to whole rupiah", () => {
    expect(potonganSatuan(promo({ id: "p", type: "PERSEN", value: 15 }), 9_999_900)).toBe(1_500_000);
    const h = hitung([baris("a", 99_999, 1)], [promo({ id: "p", type: "PERSEN", value: 10 })]);
    expect(h.baris[0].potonganPromo).toBe(10_000);
    expect(h.total).toBe(89_999);
  });

  it("never discounts below zero", () => {
    const h = hitung([baris("a", 20_000, 1)], [promo({ id: "p", type: "POTONGAN", value: 50_000 })]);
    expect(h.total).toBe(0);
    const k = hitung([baris("a", 20_000, 1)], [promo({ id: "k", type: "HARGA_KHUSUS", value: 30_000 })]);
    expect(k.potonganTotal).toBe(0);
    expect(k.baris[0].promoId).toBeNull();
  });

  it("gives each piece the best promo at the same priority", () => {
    const h = hitung(
      [baris("a", 100_000, 1)],
      [promo({ id: "persen", type: "PERSEN", value: 10 }), promo({ id: "khusus", type: "HARGA_KHUSUS", value: 79_000 })],
    );
    expect(h.baris[0].promoId).toBe("khusus");
    expect(h.total).toBe(79_000);
  });

  it("lets a higher priority win even when it gives less", () => {
    const h = hitung(
      [baris("a", 100_000, 1)],
      [promo({ id: "besar", type: "PERSEN", value: 50 }), promo({ id: "utama", type: "PERSEN", value: 10, priority: 5 })],
    );
    expect(h.baris[0].promoId).toBe("utama");
    expect(h.total).toBe(90_000);
  });

  it("only touches the items, categories and stores it targets", () => {
    const p = promo({ id: "kat", type: "PERSEN", value: 20, allItems: false, categoryIds: ["kemeja"] });
    const h = hitung([baris("a", 100_000, 1, { categoryId: "kemeja" }), baris("b", 100_000, 1, { categoryId: "celana" })], [p]);
    expect(h.baris.map((x) => x.potonganPromo)).toEqual([20_000, 0]);
    const lain = hitung([baris("a", 100_000, 1)], [promo({ id: "t", type: "PERSEN", value: 20, allStores: false, storeIds: ["toko-2"] })]);
    expect(lain.potonganTotal).toBe(0);
  });

  it("respects the date window and the off switch", () => {
    const lewat = promo({ id: "lewat", type: "PERSEN", value: 20, endsAt: "2026-10-02T16:59:59Z" });
    const nanti = promo({ id: "nanti", type: "PERSEN", value: 20, startsAt: "2026-10-04T00:00:00Z" });
    const mati = promo({ id: "mati", type: "PERSEN", value: 20, isActive: false });
    expect(hitung([baris("a", 100_000, 1)], [lewat, nanti, mati]).potonganTotal).toBe(0);
    // Nota jam 21.00 yang baru terkirim besok tetap kena promo yang berakhir tengah malam.
    const malam = promo({ id: "malam", type: "PERSEN", value: 20, endsAt: "2026-10-03T16:59:59Z" });
    const h = hitungPromoKonter({ baris: [baris("a", 100_000, 1)], promos: [malam], storeId: "toko-1", waktu: new Date("2026-10-03T14:00:00Z") });
    expect(h.ok && h.total).toBe(80_000);
  });
});

describe("beli X gratis Y", () => {
  const b2g1 = promo({ id: "b2g1", type: "BELI_GRATIS", buyQty: 2, freeQty: 1 });

  it("frees the cheapest piece of each full group, mixing items", () => {
    const h = hitung([baris("a", 150_000, 1), baris("b", 100_000, 1), baris("c", 80_000, 1)], [b2g1]);
    expect(h.baris.map((x) => x.gratis)).toEqual([0, 0, 1]);
    expect(h.total).toBe(250_000);
    // Potong yang dibayar di dalam paket juga "kena promo", jadi ditandai.
    expect(h.baris.every((x) => x.promoName === "b2g1")).toBe(true);
  });

  it("leaves pieces of an incomplete group free for lower-priority promos", () => {
    const sisa = promo({ id: "sisa", type: "PERSEN", value: 10, priority: -1 });
    const h = hitung([baris("a", 100_000, 4)], [b2g1, sisa]);
    // 3 potong jadi satu paket (1 gratis), potong ke-4 kena diskon 10%.
    expect(h.baris[0].gratis).toBe(1);
    expect(h.total).toBe(200_000 + 90_000);
    expect(h.baris[0].promoName).toBe("b2g1 + sisa");
  });
});

describe("promo belanja dan diskon manual", () => {
  it("applies the best spend promo on the net after item promos, split across lines", () => {
    const h = hitung(
      [baris("a", 300_000, 1), baris("b", 200_000, 1)],
      [
        promo({ id: "barang", type: "PERSEN", value: 10, allItems: false, itemIds: ["a"] }),
        promo({ id: "min400", type: "MIN_BELANJA_PERSEN", value: 10, minSubtotal: 400_000 }),
        promo({ id: "min100", type: "MIN_BELANJA_POTONGAN", value: 20_000, minSubtotal: 100_000 }),
      ],
    );
    // Bersih sesudah promo barang = 270.000 + 200.000 = 470.000 → 10% = 47.000 > 20.000.
    expect(h.promoNota).toEqual({ id: "min400", name: "min400", potongan: 47_000 });
    expect(h.total).toBe(423_000);
    expect(h.baris.reduce((s, x) => s + x.bersih, 0)).toBe(h.total);
  });

  it("skips a spend promo whose minimum is not reached", () => {
    const h = hitung([baris("a", 99_000, 1)], [promo({ id: "min", type: "MIN_BELANJA_POTONGAN", value: 10_000, minSubtotal: 100_000 })]);
    expect(h.promoNota).toBeNull();
  });

  it("refuses a manual discount when the office has not enabled it", () => {
    const h = hitungPromoKonter({
      baris: [baris("a", 100_000, 1)],
      promos: [],
      storeId: "toko-1",
      waktu: WAKTU,
      diskonManual: { jenis: "PERSEN", nilai: 5 },
    });
    expect(h).toEqual({ ok: false, code: "DISKON_MANUAL_NONAKTIF" });
  });

  it("caps a manual discount at the office limit", () => {
    const dasar = { baris: [baris("a", 100_000, 1)], promos: [], storeId: "toko-1", waktu: WAKTU, aturanManual: { aktif: true, maksPersen: 10 } };
    expect(hitungPromoKonter({ ...dasar, diskonManual: { jenis: "RUPIAH", nilai: 10_001 } })).toEqual({
      ok: false,
      code: "DISKON_MANUAL_LEWAT_BATAS",
    });
    const h = hitungPromoKonter({ ...dasar, diskonManual: { jenis: "RUPIAH", nilai: 10_000 } });
    expect(h.ok && h.total).toBe(90_000);
  });

  it("keeps the line nets summing exactly to the total with awkward splits", () => {
    const h = hitung([baris("a", 33_333, 1), baris("b", 33_333, 1), baris("c", 33_334, 1)], [], {
      diskonManual: { jenis: "RUPIAH", nilai: 1_001 },
      aturanManual: { aktif: true, maksPersen: 5 },
    });
    expect(h.diskonManual).toBe(1_001);
    expect(Math.round(h.baris.reduce((s, x) => s + x.bersih, 0) * 100)).toBe(Math.round(h.total * 100));
  });
});

describe("bagian toko konsinyasi", () => {
  it("splits each discount by the share of the promo that gave it", () => {
    const h = hitung(
      [baris("a", 100_000, 1), baris("b", 100_000, 1)],
      [
        promo({ id: "bagi", type: "PERSEN", value: 20, allItems: false, itemIds: ["a"], storeSharePercent: 50 }),
        promo({ id: "penuh", type: "PERSEN", value: 10, allItems: false, itemIds: ["b"] }),
      ],
    );
    // a: potongan 20.000, toko 50% = 10.000; b: potongan 10.000 ditanggung penuh Elorae.
    expect(h.baris.map((x) => x.potonganToko)).toEqual([10_000, 0]);
    expect(h.potonganToko).toBe(10_000);
  });

  it("applies the manual-discount store share too", () => {
    const h = hitung([baris("a", 100_000, 1)], [], {
      diskonManual: { jenis: "RUPIAH", nilai: 10_000 },
      aturanManual: { aktif: true, maksPersen: 10, bagianTokoPersen: 30 },
    });
    expect(h.baris[0].potonganToko).toBe(3_000);
  });
});

describe("pembantu", () => {
  it("splits by largest remainder", () => {
    expect(bagiSisaTerbesar(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(bagiSisaTerbesar(5, [0, 2, 0])).toEqual([0, 5, 0]);
    expect(bagiSisaTerbesar(0, [1, 2])).toEqual([0, 0]);
  });

  it("describes promos in Indonesian", () => {
    expect(ringkasPromoKonter({ type: "BELI_GRATIS", value: null, buyQty: 2, freeQty: 1, minSubtotal: null })).toBe("Beli 2 gratis 1");
    expect(ringkasPromoKonter({ type: "PERSEN", value: 20, buyQty: null, freeQty: null, minSubtotal: null })).toBe("Diskon 20%");
  });

  it("validates promo input", () => {
    const sah = {
      name: "Promo",
      type: "PERSEN",
      value: 20,
      buyQty: null,
      freeQty: null,
      minSubtotal: null,
      allItems: true,
      itemIds: [],
      categoryIds: [],
      allStores: true,
      storeIds: [],
      startsAt: null,
      endsAt: null,
    };
    expect(periksaPromoKonter(sah)).toEqual([]);
    expect(periksaPromoKonter({ ...sah, value: 120 })).toEqual(["PERSEN_LEWAT_100"]);
    expect(periksaPromoKonter({ ...sah, type: "BELI_GRATIS", value: null, buyQty: 0, freeQty: 1 })).toEqual(["BELI_GRATIS_TIDAK_VALID"]);
    expect(periksaPromoKonter({ ...sah, allItems: false, allStores: false })).toEqual(["BARANG_KOSONG", "TOKO_KOSONG"]);
    expect(periksaPromoKonter({ ...sah, type: "MIN_BELANJA_PERSEN", minSubtotal: null })).toEqual(["MIN_BELANJA_TIDAK_VALID"]);
    expect(periksaPromoKonter({ ...sah, startsAt: "2026-10-05", endsAt: "2026-10-01" })).toEqual(["TANGGAL_TERBALIK"]);
  });
});
