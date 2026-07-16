import { describe, it, expect } from "vitest";
import { cartTotal, cartCount, buildOrderLines, type CartLine } from "./cart";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  itemId: "i1", variantSku: "", variantLabel: null, sku: "FG-1", nameId: "Kaos", unitPrice: 35000, available: 100, qty: 6, ...over,
});

describe("cart helpers", () => {
  it("cartTotal sums qty * unitPrice", () => {
    expect(cartTotal([line({ qty: 6, unitPrice: 35000 }), line({ itemId: "i2", sku: "FG-2", qty: 2, unitPrice: 40000 })]))
      .toBe(6 * 35000 + 2 * 40000);
  });
  it("cartCount sums quantities", () => {
    expect(cartCount([line({ qty: 6 }), line({ itemId: "i2", qty: 2 })])).toBe(8);
  });
  it("empty cart → 0 / 0 / []", () => {
    expect(cartTotal([])).toBe(0);
    expect(cartCount([])).toBe(0);
    expect(buildOrderLines([])).toEqual([]);
  });
  it("buildOrderLines maps to the createFieldSalesOrder line shape (productName = nameId)", () => {
    expect(buildOrderLines([line({ itemId: "i1", variantSku: "", nameId: "Kaos", qty: 6, unitPrice: 35000 })]))
      .toEqual([{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 35000 }]);
  });
  it("buildOrderLines appends variantLabel to productName when a variant is selected", () => {
    expect(
      buildOrderLines([
        line({ itemId: "i1", variantSku: "RED-M", variantLabel: "Merah / M", nameId: "Kaos", qty: 2, unitPrice: 35000 }),
      ]),
    ).toEqual([{ itemId: "i1", variantSku: "RED-M", productName: "Kaos — Merah / M", qty: 2, unitPrice: 35000 }]);
  });
});
