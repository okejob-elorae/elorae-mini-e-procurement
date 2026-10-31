import { describe, expect, it } from "vitest";
import {
  hitungPromoKonter,
  komponenPaketSah,
  periksaPromoKonter,
  ringkasPromoKonter,
  type AnggotaNota,
  type BarisKeranjangPromo,
  type PromoKonter,
} from "./promo-konter";

const WAKTU = new Date("2026-10-20T05:00:00Z");

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

const baris = (key: string, unitPrice: number, qty: number, categoryId: string | null = null): BarisKeranjangPromo => ({
  key,
  itemId: key,
  categoryId,
  qty,
  unitPrice,
});

function hitung(b: BarisKeranjangPromo[], promos: PromoKonter[], ekstra: Partial<Parameters<typeof hitungPromoKonter>[0]> = {}) {
  const h = hitungPromoKonter({ baris: b, promos, storeId: "toko-1", waktu: WAKTU, ...ekstra });
  if (!h.ok) throw new Error(h.code);
  return h;
}

/** Σ bersih baris = total, dan rincian + member + manual = potongan baris. */
function periksaJumlah(h: ReturnType<typeof hitung>) {
  expect(h.baris.reduce((s, b) => s + b.bersih, 0)).toBeCloseTo(h.total, 6);
  for (const b of h.baris) {
    const rincian = b.rincian.reduce((s, r) => s + r.potongan, 0);
    expect(rincian + b.potonganMember + b.potonganManual).toBeCloseTo(b.potongan, 6);
    expect(b.rincian.reduce((s, r) => s + r.potonganToko, 0)).toBeLessThanOrEqual(b.potonganToko + 1e-9);
  }
}

const paketKaosCelana = (ekstra: Partial<PromoKonter> = {}) =>
  promo({
    id: "paket",
    type: "PAKET",
    value: 250_000,
    allItems: false,
    itemIds: ["celana"],
    categoryIds: ["kaos"],
    komponen: [
      { jenis: "CATEGORY", refId: "kaos", qty: 1 },
      { jenis: "ITEM", refId: "celana", qty: 1 },
    ],
    ...ekstra,
  });

describe("promo paket", () => {
  it("prices one full bundle at the bundle price and splits the discount by price", () => {
    const h = hitung([baris("kaos-a", 120_000, 1, "kaos"), baris("celana", 180_000, 1)], [paketKaosCelana()]);
    expect(h.subtotal).toBe(300_000);
    expect(h.total).toBe(250_000);
    expect(h.baris.map((b) => b.potongan)).toEqual([20_000, 30_000]);
    expect(h.baris[0].rincian).toEqual([{ promoId: "paket", name: "paket", kind: "BARANG", qty: 1, potongan: 20_000, potonganToko: 0 }]);
    periksaJumlah(h);
  });

  it("forms as many bundles as the cart completes and leaves the rest at full price", () => {
    const h = hitung([baris("kaos-a", 120_000, 3, "kaos"), baris("celana", 180_000, 2)], [paketKaosCelana()]);
    expect(h.total).toBe(500_000 + 120_000);
    expect(h.baris[0].rincian[0].qty).toBe(2);
    periksaJumlah(h);
  });

  it("does not form when a component is missing", () => {
    const h = hitung([baris("kaos-a", 120_000, 2, "kaos")], [paketKaosCelana()]);
    expect(h.total).toBe(240_000);
    expect(h.baris[0].rincian).toEqual([]);
  });

  it("never raises the price: a bundle priced above the pieces is not formed", () => {
    const h = hitung([baris("kaos-a", 50_000, 1, "kaos"), baris("celana", 60_000, 1)], [paketKaosCelana()]);
    expect(h.total).toBe(110_000);
  });

  it("takes the most expensive matching pieces for a category component", () => {
    const h = hitung(
      [baris("kaos-murah", 80_000, 1, "kaos"), baris("kaos-mahal", 150_000, 1, "kaos"), baris("celana", 180_000, 1)],
      [paketKaosCelana()],
    );
    // Paket = kaos mahal + celana (330 rb → 250 rb); kaos murah bayar penuh.
    expect(h.total).toBe(250_000 + 80_000);
    expect(h.baris[0].potongan).toBe(0);
    periksaJumlah(h);
  });

  it("goes before unit promos of the same priority, so a store-wide 10% does not block the bundle", () => {
    const h = hitung(
      [baris("kaos-a", 120_000, 1, "kaos"), baris("celana", 180_000, 1), baris("topi", 50_000, 1)],
      [paketKaosCelana(), promo({ id: "diskon10", type: "PERSEN", value: 10 })],
    );
    expect(h.total).toBe(250_000 + 45_000);
    expect(h.baris[2].rincian[0].promoId).toBe("diskon10");
    periksaJumlah(h);
  });

  it("a higher-priority unit promo still wins the pieces first", () => {
    const h = hitung(
      [baris("kaos-a", 120_000, 1, "kaos"), baris("celana", 180_000, 1)],
      [paketKaosCelana(), promo({ id: "diskon10", type: "PERSEN", value: 10, priority: 5 })],
    );
    expect(h.total).toBe(270_000);
  });

  it("charges the store its share of a bundle at a konsi store", () => {
    const h = hitung([baris("kaos-a", 120_000, 1, "kaos"), baris("celana", 180_000, 1)], [paketKaosCelana({ storeSharePercent: 50 })]);
    expect(h.potonganToko).toBe(25_000);
    periksaJumlah(h);
  });

  it("describes and validates a bundle", () => {
    expect(ringkasPromoKonter({ type: "PAKET", value: 250_000, buyQty: null, freeQty: null, minSubtotal: null, komponen: paketKaosCelana().komponen })).toBe(
      "Paket 2 potong Rp250.000",
    );
    expect(komponenPaketSah([{ jenis: "ITEM", refId: "a", qty: 1 }])).toBe(false);
    expect(komponenPaketSah([{ jenis: "ITEM", refId: "a", qty: 2 }])).toBe(true);
    expect(komponenPaketSah([{ jenis: "ITEM", refId: "a", qty: 1 }, { jenis: "ITEM", refId: "a", qty: 1 }])).toBe(false);
    expect(komponenPaketSah([{ jenis: "ITEM", refId: "a", qty: 1.5 }, { jenis: "ITEM", refId: "b", qty: 1 }])).toBe(false);
    const dasar = { name: "P", type: "PAKET", value: 250_000, buyQty: null, freeQty: null, minSubtotal: null, allStores: true, storeIds: [], startsAt: null, endsAt: null };
    expect(periksaPromoKonter({ ...dasar, allItems: false, itemIds: ["a"], categoryIds: [], komponen: [{ jenis: "ITEM", refId: "a", qty: 2 }] })).toEqual([]);
    expect(periksaPromoKonter({ ...dasar, allItems: true, itemIds: [], categoryIds: [], komponen: [{ jenis: "ITEM", refId: "a", qty: 2 }] })).toContain(
      "PAKET_TIDAK_VALID",
    );
    expect(periksaPromoKonter({ ...dasar, value: 0, allItems: false, itemIds: ["a"], categoryIds: [], komponen: [{ jenis: "ITEM", refId: "a", qty: 2 }] })).toContain(
      "NILAI_TIDAK_VALID",
    );
  });
});

const gold: AnggotaNota = { tingkat: "Gold", diskonPersen: 10, gabungPromo: false, bagianTokoPersen: 0 };

describe("member", () => {
  it("member-only promos apply only to members, but the banner still lists them", () => {
    const khusus = promo({ id: "khusus", type: "PERSEN", value: 20, memberOnly: true });
    const tanpa = hitung([baris("a", 100_000, 1)], [khusus]);
    expect(tanpa.total).toBe(100_000);
    expect(tanpa.berlaku).toEqual([{ id: "khusus", name: "khusus", type: "PERSEN", memberOnly: true }]);
    const dengan = hitung([baris("a", 100_000, 1)], [khusus], { anggota: { ...gold, diskonPersen: 0 } });
    expect(dengan.total).toBe(80_000);
    expect(dengan.member).toEqual({ tingkat: "Gold", potongan: 0 });
  });

  it("gives the tier discount only on pieces without an item promo by default", () => {
    const h = hitung([baris("a", 100_000, 1, "x"), baris("b", 200_000, 1)], [promo({ id: "p", type: "PERSEN", value: 50, allItems: false, categoryIds: ["x"] })], {
      anggota: gold,
    });
    expect(h.baris[0].potonganMember).toBe(0);
    expect(h.baris[1].potonganMember).toBe(20_000);
    expect(h.member).toEqual({ tingkat: "Gold", potongan: 20_000 });
    expect(h.total).toBe(50_000 + 180_000);
    periksaJumlah(h);
  });

  it("can stack with item promos when the office allows it", () => {
    const h = hitung([baris("a", 100_000, 1, "x")], [promo({ id: "p", type: "PERSEN", value: 50, allItems: false, categoryIds: ["x"] })], {
      anggota: { ...gold, gabungPromo: true },
    });
    expect(h.total).toBe(45_000);
  });

  it("comes before the minimum-spend promo, which then reads the smaller net", () => {
    const belanja = promo({ id: "min", type: "MIN_BELANJA_POTONGAN", value: 25_000, minSubtotal: 300_000 });
    const h = hitung([baris("a", 300_000, 1)], [belanja], { anggota: gold });
    // 300 rb − 10% member = 270 rb < 300 rb → promo belanja tidak berlaku.
    expect(h.promoNota).toBeNull();
    expect(h.total).toBe(270_000);
    const bukan = hitung([baris("a", 300_000, 1)], [belanja]);
    expect(bukan.total).toBe(275_000);
  });

  it("rounds the member discount to whole rupiah and keeps line nets summing to the total", () => {
    const h = hitung([baris("a", 33_333, 1), baris("b", 33_333, 2)], [], { anggota: { ...gold, diskonPersen: 7 } });
    expect(Number.isInteger(h.member!.potongan)).toBe(true);
    periksaJumlah(h);
  });

  it("charges the store its share of the member discount when configured", () => {
    const h = hitung([baris("a", 100_000, 1)], [], { anggota: { ...gold, bagianTokoPersen: 40 } });
    expect(h.potonganToko).toBe(4_000);
  });

  it("records the minimum-spend promo per line in the detail", () => {
    const belanja = promo({ id: "min", type: "MIN_BELANJA_PERSEN", value: 10, minSubtotal: 100_000 });
    const h = hitung([baris("a", 100_000, 1), baris("b", 50_000, 2)], [belanja]);
    expect(h.baris.map((b) => b.rincian.map((r) => [r.kind, r.qty, r.potongan]))).toEqual([[["BELANJA", 1, 10_000]], [["BELANJA", 2, 10_000]]]);
    periksaJumlah(h);
  });
});
