import { describe, expect, it } from "vitest";
import { isStockableVariantKey, itemHasSkuVariants } from "./variants";

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

  it("does not treat plan-year { variantSku } rows as Item.variants JSON", () => {
    expect(itemHasSkuVariants([{ variantSku: "FG-SHIRT-RED-M", label: "RED · M" }])).toBe(false);
  });
});

describe("isStockableVariantKey", () => {
  const variants = [{ sku: "FG-SHIRT-RED-M", color: "RED" }];

  it("is true for a variant item's own SKU", () => {
    expect(isStockableVariantKey(variants, "FG-SHIRT-RED-M")).toBe(true);
  });

  it('is false for "" on a variant item', () => {
    expect(isStockableVariantKey(variants, "")).toBe(false);
  });

  it("is false for an unknown SKU on a variant item", () => {
    expect(isStockableVariantKey(variants, "NO-SUCH-SKU")).toBe(false);
  });

  it('is true for "" on a variantless item', () => {
    expect(isStockableVariantKey(null, "")).toBe(true);
  });

  it("is false for a SKU on a variantless item", () => {
    expect(isStockableVariantKey(null, "FG-SHIRT-RED-M")).toBe(false);
  });

  it("matches a variant SKU trimmed of surrounding spaces in the JSON", () => {
    expect(isStockableVariantKey([{ sku: "  FG-SHIRT-RED-M  " }], "FG-SHIRT-RED-M")).toBe(true);
  });
});
