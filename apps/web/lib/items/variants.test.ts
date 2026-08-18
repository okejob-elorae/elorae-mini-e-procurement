import { describe, expect, it } from "vitest";
import { itemHasSkuVariants } from "./variants";

describe("itemHasSkuVariants", () => {
  it("is true when a variant row has a sku", () => {
    expect(itemHasSkuVariants([{ sku: "FG-SHIRT-RED-M", color: "RED" }])).toBe(true);
  });

  it("is false for missing, empty, or sku-less rows", () => {
    expect(itemHasSkuVariants(null)).toBe(false);
    expect(itemHasSkuVariants([])).toBe(false);
    expect(itemHasSkuVariants([{ color: "RED" }])).toBe(false);
    expect(itemHasSkuVariants([{ sku: "   " }])).toBe(false);
  });
});
