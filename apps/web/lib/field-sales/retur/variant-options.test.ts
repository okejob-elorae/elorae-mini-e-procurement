import { describe, it, expect } from "vitest";
import { isReturnableVariantKey, returVariantOptions } from "./variant-options";

const declared = [
  { sku: "A-S", size: "S" },
  { sku: "A-M", size: "M" },
];

const POOLED = { variantSku: "", variantLabel: "" };

describe("returVariantOptions / isReturnableVariantKey", () => {
  it("returns no options for a simple item and accepts only the empty key", () => {
    const input = { variants: [], inventorySkus: [null], storeStockSkus: [] };
    expect(returVariantOptions(input)).toEqual([]);
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "M" })).toBe(false);
  });

  it("offers only the pooled key on a variant item whose inventory is one pooled row", () => {
    for (const pooledSku of [null, ""]) {
      const input = { variants: declared, inventorySkus: [pooledSku], storeStockSkus: [] };
      expect(returVariantOptions(input)).toEqual([POOLED]);
      expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
      expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(false);
      expect(isReturnableVariantKey({ ...input, variantSku: "A-M" })).toBe(false);
    }
  });

  it("offers the pooled key plus every real per-variant row on a pooled item", () => {
    const input = { variants: declared, inventorySkus: [null, "A-M"], storeStockSkus: [] };
    expect(returVariantOptions(input)).toEqual([POOLED, { variantSku: "A-M", variantLabel: "M (A-M)" }]);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-M" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(false);
  });

  it("accepts a variant the store holds a row for, even on a pooled item", () => {
    const input = { variants: declared, inventorySkus: [null], storeStockSkus: ["A-S"] };
    expect(returVariantOptions(input)).toEqual([POOLED, { variantSku: "A-S", variantLabel: "S (A-S)" }]);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-M" })).toBe(false);
  });

  it("offers declared variants on a non-pooled item and refuses the empty key", () => {
    for (const inventorySkus of [[], ["A-S"]]) {
      const input = { variants: declared, inventorySkus, storeStockSkus: [] };
      expect(returVariantOptions(input)).toEqual([
        { variantSku: "A-M", variantLabel: "M (A-M)" },
        { variantSku: "A-S", variantLabel: "S (A-S)" },
      ]);
      expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(true);
      expect(isReturnableVariantKey({ ...input, variantSku: "A-M" })).toBe(true);
      expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(false);
    }
  });

  it("accepts the empty key on a non-pooled item when the store holds a pooled row", () => {
    const input = { variants: declared, inventorySkus: ["A-S", "A-M"], storeStockSkus: [""] };
    expect(returVariantOptions(input)[0]).toEqual(POOLED);
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(true);
  });

  it("offers an inventory-only SKU labelled by itself", () => {
    const input = { variants: declared, inventorySkus: ["OLD-1"], storeStockSkus: [] };
    expect(returVariantOptions(input)).toContainEqual({ variantSku: "OLD-1", variantLabel: "OLD-1" });
    expect(isReturnableVariantKey({ ...input, variantSku: "OLD-1" })).toBe(true);
  });

  it("offers a store-only SKU beside the empty key of a simple item", () => {
    const input = { variants: [], inventorySkus: [null], storeStockSkus: ["STORE-1"] };
    expect(returVariantOptions(input)).toEqual([POOLED, { variantSku: "STORE-1", variantLabel: "STORE-1" }]);
    expect(isReturnableVariantKey({ ...input, variantSku: "STORE-1" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
  });

  it("folds case for matching and shows the catalog spelling once", () => {
    const input = { variants: declared, inventorySkus: [null, "a-s"], storeStockSkus: ["A-s"] };
    const options = returVariantOptions(input);
    expect(options).toEqual([POOLED, { variantSku: "A-S", variantLabel: "S (A-S)" }]);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "a-s" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-s" })).toBe(true);
  });

  it("never accepts a spelling no source holds", () => {
    const input = { variants: declared, inventorySkus: ["A-S"], storeStockSkus: [] };
    expect(isReturnableVariantKey({ ...input, variantSku: "a-s" })).toBe(false);
    expect(isReturnableVariantKey({ ...input, variantSku: " " })).toBe(false);
  });

  it("collapses duplicates across sources into one option", () => {
    const input = { variants: declared, inventorySkus: ["A-S", "A-S"], storeStockSkus: ["A-S"] };
    const skus = returVariantOptions(input).map((o) => o.variantSku);
    expect(skus.filter((s) => s === "A-S")).toHaveLength(1);
    expect(skus).toEqual(["A-M", "A-S"]);
  });
});
