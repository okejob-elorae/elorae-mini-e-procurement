import { describe, it, expect } from "vitest";
import { alokasikanBonus, catatanKurangBonus, pilihVarianHadiah } from "./bonus-alokasi";

const calon = (o: { itemId: string; variantSku: string | null; qty: number; promoId?: string }) => ({
  promoId: o.promoId ?? "p",
  itemId: o.itemId,
  variantSku: o.variantSku,
  qty: o.qty,
  itemIds: [o.itemId],
  qtyDibeli: 0,
});

describe("pilihVarianHadiah", () => {
  it("largest available real variant, tie → smallest SKU", () => {
    expect(pilihVarianHadiah([{ variantSku: "B", available: 5 }, { variantSku: "A", available: 5 }, { variantSku: "C", available: 2 }])).toBe("A");
    expect(pilihVarianHadiah([{ variantSku: "", available: 50 }, { variantSku: "M", available: 1 }])).toBe("M");
  });
  it("simple item → \"\"; no stock rows → null", () => {
    expect(pilihVarianHadiah([{ variantSku: "", available: 3 }])).toBe("");
    expect(pilihVarianHadiah([])).toBeNull();
  });
});

describe("alokasikanBonus", () => {
  it("gives everything when stock allows", () => {
    const r = alokasikanBonus([calon({ itemId: "a", variantSku: "", qty: 2 })], new Map([["a", [{ variantSku: "", available: 10 }]]]));
    expect(r).toEqual([{ promoId: "p", itemId: "a", variantSku: "", qty: 2, diminta: 2, kurang: 0 }]);
  });
  it("caps at available and records the shortfall — never blocks", () => {
    const r = alokasikanBonus([calon({ itemId: "a", variantSku: "", qty: 3 })], new Map([["a", [{ variantSku: "", available: 1 }]]]));
    expect(r[0]).toMatchObject({ qty: 1, kurang: 2 });
  });
  it("negative availability gives zero", () => {
    const r = alokasikanBonus([calon({ itemId: "a", variantSku: "", qty: 3 })], new Map([["a", [{ variantSku: "", available: -4 }]]]));
    expect(r[0]).toMatchObject({ qty: 0, kurang: 3 });
  });
  it("two bonus lines on the same variant share the stock", () => {
    const r = alokasikanBonus(
      [calon({ promoId: "p1", itemId: "g", variantSku: "", qty: 2 }), calon({ promoId: "p2", itemId: "g", variantSku: "", qty: 2 })],
      new Map([["g", [{ variantSku: "", available: 3 }]]]),
    );
    expect(r.map((b) => b.qty)).toEqual([2, 1]);
    expect(r[1].kurang).toBe(1);
  });
  it("a gift not on the order gets its best-stocked variant", () => {
    const r = alokasikanBonus([calon({ itemId: "g", variantSku: null, qty: 1 })], new Map([["g", [{ variantSku: "S", available: 1 }, { variantSku: "L", available: 9 }]]]));
    expect(r[0]).toMatchObject({ variantSku: "L", qty: 1 });
  });
  it("a gift with no stock rows at all gives nothing", () => {
    const r = alokasikanBonus([calon({ itemId: "g", variantSku: null, qty: 2 })], new Map());
    expect(r[0]).toEqual({ promoId: "p", itemId: "g", variantSku: "", qty: 0, diminta: 2, kurang: 2 });
  });
});

describe("catatanKurangBonus", () => {
  it("null when nothing is short", () => {
    expect(catatanKurangBonus([{ kurang: 0, productName: "Kaos", promoName: "Beli 6" }])).toBeNull();
  });
  it("one sentence per short bonus", () => {
    expect(
      catatanKurangBonus([
        { kurang: 2, productName: "Kaos — M", promoName: "Beli 6 gratis 1" },
        { kurang: 0, productName: "Topi", promoName: "X" },
      ]),
    ).toBe("[Bonus] Kurang 2 pcs Kaos — M (promo Beli 6 gratis 1) — stok tidak cukup.");
  });
});
