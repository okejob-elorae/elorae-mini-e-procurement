import { describe, expect, it } from "vitest";
import { itemHasSkuVariants, parseItemVariants, variantSelectOptions } from "./variants";

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

describe("parseItemVariants — data lama", () => {
  it("reads variants stored as JSON text", () => {
    expect(parseItemVariants('[{"sku":"A-M","size":"M"}]')).toEqual([{ sku: "A-M", size: "M" }]);
    expect(parseItemVariants("bukan json")).toEqual([]);
  });

  it("normalises upper-case SKU and Barcode keys without touching other keys", () => {
    expect(parseItemVariants([{ SKU: "A-L", Barcode: "123", Size: "L" }])).toEqual([{ sku: "A-L", barcode: "123", Size: "L" }]);
  });
});

describe("variantSelectOptions — varian warna bahan", () => {
  it("label memakai kunci warna", () => {
    expect(variantSelectOptions([{ warna: "HITAM", sku: "FAB-1-HITAM", pantone: "19-4005 TCX" }])).toEqual([
      { sku: "FAB-1-HITAM", label: "HITAM (FAB-1-HITAM)" },
    ]);
  });
});
