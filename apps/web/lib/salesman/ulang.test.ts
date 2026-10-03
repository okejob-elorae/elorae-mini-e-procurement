import { describe, expect, it } from "vitest";
import { susunIsiUlang } from "./ulang";

const kaos = {
  itemId: "kaos",
  sku: "KAOS",
  nameId: "Kaos Polo",
  price: 100_000,
  available: 50,
  variants: [
    { variantSku: "KAOS-M", variantLabel: "M", available: 3 },
    { variantSku: "KAOS-L", variantLabel: "L", available: 0 },
  ],
};
const topi = { itemId: "topi", sku: "TOPI", nameId: "Topi", price: 40_000, available: 10, variants: [] };

describe("susunIsiUlang", () => {
  it("puts the old lines back, capped at what is available now", () => {
    const r = susunIsiUlang(
      [kaos, topi],
      [
        { itemId: "kaos", variantSku: "KAOS-M", qty: 6 },
        { itemId: "topi", variantSku: "", qty: 4 },
      ],
      false,
    );
    expect(r.dilewati).toBe(0);
    expect(r.baris).toEqual([
      expect.objectContaining({ itemId: "kaos", variantSku: "KAOS-M", variantLabel: "M", qty: 3, available: 3, unitPrice: 100_000 }),
      expect.objectContaining({ itemId: "topi", variantSku: "", variantLabel: null, qty: 4, available: 10, unitPrice: 40_000 }),
    ]);
  });

  it("skips and counts lines that are sold out or no longer in the catalog", () => {
    const r = susunIsiUlang(
      [kaos],
      [
        { itemId: "kaos", variantSku: "KAOS-L", qty: 2 }, // habis
        { itemId: "hilang", variantSku: "", qty: 1 }, // tidak dijual lagi
        { itemId: "kaos", variantSku: "KAOS-XL", qty: 1 }, // varian tidak ada
      ],
      false,
    );
    expect(r).toEqual({ baris: [], dilewati: 3 });
  });

  it("never carries a price into a consignment cart", () => {
    const r = susunIsiUlang([topi], [{ itemId: "topi", variantSku: "", qty: 1 }], true);
    expect(r.baris[0].unitPrice).toBe(0);
  });
});
