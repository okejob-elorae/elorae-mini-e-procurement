import { describe, it, expect } from "vitest";
import { isReturnableVariantKey, returVariantOptions } from "./variant-options";

const declared = [
  { sku: "A-S", size: "S" },
  { sku: "A-M", size: "M" },
];

describe("returVariantOptions", () => {
  it("returns no options for a simple item", () => {
    const input = { variants: [], inventorySkus: [null], storeStockSkus: [] };
    expect(returVariantOptions(input)).toEqual([]);
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
    expect(isReturnableVariantKey({ ...input, variantSku: "M" })).toBe(false);
  });

  it("offers declared variants even when inventory is one pooled row, and refuses the empty key", () => {
    const input = { variants: declared, inventorySkus: [null], storeStockSkus: [] };
    expect(returVariantOptions(input)).toEqual([
      { variantSku: "A-M", variantLabel: "M (A-M)" },
      { variantSku: "A-S", variantLabel: "S (A-S)" },
    ]);
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(false);
    expect(isReturnableVariantKey({ ...input, variantSku: "A-S" })).toBe(true);
  });

  it("accepts the empty key when the store holds legacy pooled stock", () => {
    const input = { variants: declared, inventorySkus: [null], storeStockSkus: [""] };
    expect(isReturnableVariantKey({ ...input, variantSku: "" })).toBe(true);
    expect(returVariantOptions(input).map((o) => o.variantSku)).toEqual(["A-M", "A-S"]);
  });

  it("offers an inventory-only SKU labelled by itself", () => {
    const input = { variants: declared, inventorySkus: ["OLD-1"], storeStockSkus: [] };
    expect(returVariantOptions(input)).toContainEqual({ variantSku: "OLD-1", variantLabel: "OLD-1" });
    expect(isReturnableVariantKey({ ...input, variantSku: "OLD-1" })).toBe(true);
  });

  it("offers a store-only SKU", () => {
    const input = { variants: [], inventorySkus: [null], storeStockSkus: ["STORE-1"] };
    expect(returVariantOptions(input)).toEqual([{ variantSku: "STORE-1", variantLabel: "STORE-1" }]);
    expect(isReturnableVariantKey({ ...input, variantSku: "STORE-1" })).toBe(true);
  });

  it("matches the exact spelling only", () => {
    const input = { variants: declared, inventorySkus: [null], storeStockSkus: [] };
    expect(isReturnableVariantKey({ ...input, variantSku: "a-s" })).toBe(false);
  });

  it("collapses duplicates across sources into one option", () => {
    const input = { variants: declared, inventorySkus: ["A-S", "A-S", ""], storeStockSkus: ["A-S"] };
    const skus = returVariantOptions(input).map((o) => o.variantSku);
    expect(skus.filter((s) => s === "A-S")).toHaveLength(1);
    expect(skus).toHaveLength(2);
  });
});
