import { describe, expect, it } from "vitest";
import { barisCetakPo } from "./cetak-po";

const kain = {
  sku: "FAB-1",
  nameId: "Kain Katun",
  type: "FABRIC",
  variants: [{ warna: "HITAM", sku: "FAB-1-HITAM", pantone: "19-4005 TCX" }],
  kgPerRoll: 25,
  uom: { code: "KG" },
};

describe("barisCetakPo", () => {
  it("bahan berwarna: kolom Warna (bukan rincian atribut) dan Roll", () => {
    const [b] = barisCetakPo([{ variantSku: "FAB-1-HITAM", notes: " ", qty: 60, price: 1000, item: kain }]);
    expect(b).toMatchObject({
      itemName: "Kain Katun",
      variantSku: "FAB-1-HITAM",
      variantDetail: null,
      lineNotes: null,
      amount: 60_000,
      warna: "HITAM · 19-4005 TCX",
      roll: 3,
    });
  });

  it("barang jadi tidak mendapat kolom Warna/Roll; rincian variannya tetap", () => {
    const [b] = barisCetakPo([
      {
        variantSku: "KAOS-M",
        notes: null,
        qty: 10,
        price: 5,
        item: { sku: "KAOS", nameId: "Kaos", type: "FINISHED_GOOD", variants: [{ color: "Hitam", sku: "KAOS-M" }], uom: { code: "PCS" } },
      },
    ]);
    expect(b.warna).toBeNull();
    expect(b.roll).toBeNull();
    expect(b.variantDetail).toBe("color: Hitam");
  });

  it("bahan non-kg atau tanpa kg per roll: roll kosong", () => {
    const [b] = barisCetakPo([{ variantSku: null, notes: null, qty: 60, price: 1, item: { ...kain, kgPerRoll: null } }]);
    expect(b.roll).toBeNull();
    expect(b.warna).toBeNull();
  });
});
