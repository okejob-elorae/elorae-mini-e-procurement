import { describe, expect, it } from "vitest";
import {
  buildVariantSkuCode,
  validateAndNormalizeVariants,
  variantSkuBase,
} from "./normalize-variants";

describe("validateAndNormalizeVariants", () => {
  const variants = [
    { Warna: "Merah", Ukuran: "M", sku: "" },
    { Warna: "Biru Muda", Ukuran: "L", sku: "" },
  ];

  it("keeps the form's default: a blank variant SKU is generated from the category code when there is one", () => {
    const out = validateAndNormalizeVariants("KMJ-01", variants, { categoryCode: "KMJ" });
    expect(out.map((v) => v.sku)).toEqual(["KMJ-MERAH-M", "KMJ-BIRUMUDA-L"]);
  });

  it("generates from the parent SKU when asked, so two artikels in one category cannot collide", () => {
    const out = validateAndNormalizeVariants("KMJ-01", variants, { categoryCode: "KMJ", generateFrom: "parent" });
    expect(out.map((v) => v.sku)).toEqual(["KMJ-01-MERAH-M", "KMJ-01-BIRUMUDA-L"]);
  });

  it("still accepts a typed SKU prefixed by the category code in parent mode", () => {
    const out = validateAndNormalizeVariants("KMJ-01", [{ Warna: "Merah", sku: "KMJ-RED" }], {
      categoryCode: "KMJ",
      generateFrom: "parent",
    });
    expect(out[0].sku).toBe("KMJ-RED");
  });

  it("rewrites a typed SKU lacking both prefixes onto the generation base", () => {
    const out = validateAndNormalizeVariants("KMJ-01", [{ Warna: "Merah", sku: "merah-m" }], {
      categoryCode: "KMJ",
      generateFrom: "parent",
    });
    expect(out[0].sku).toBe("KMJ-01-MERAHM");
  });

  it("refuses duplicate variant SKUs and barcodes case-insensitively", () => {
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-X" }, { sku: "A-x" }], {}),
    ).toThrow("Duplicate variant SKU");
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-1", barcode: "X1" }, { sku: "A-2", barcode: "x1" }], {}),
    ).toThrow("Duplicate variant barcode");
  });

  it("returns an empty list for no variants", () => {
    expect(validateAndNormalizeVariants("A", undefined)).toEqual([]);
  });

  it("generates a blank SKU from the parent SKU by default, not the category code", () => {
    const out = validateAndNormalizeVariants("KMJ01", [{ Warna: "Merah", sku: "" }], {
      categoryCode: "BAJU",
    });
    expect(out[0].sku).toBe("KMJ01-MERAH");
  });

  it("keeps a typed category-prefixed SKU unchanged under the parent default", () => {
    const out = validateAndNormalizeVariants("KMJ01", [{ Warna: "Merah", sku: "BAJU-MERAH-M" }], {
      categoryCode: "BAJU",
    });
    expect(out[0].sku).toBe("BAJU-MERAH-M");
  });

  it("still generates from the category code when asked", () => {
    const out = validateAndNormalizeVariants("KMJ01", [{ Warna: "Merah", sku: "" }], {
      categoryCode: "BAJU",
      generateFrom: "category",
    });
    expect(out[0].sku).toBe("BAJU-MERAH");
  });

  it("picks the parent SKU as the base and falls back to the category code", () => {
    expect(variantSkuBase("", "BAJU")).toBe("BAJU");
    expect(variantSkuBase(" KMJ01 ", "BAJU")).toBe("KMJ01");
    expect(variantSkuBase("", null)).toBe("");
  });

  it("builds the variant code as {base}-{slugs} in attribute order", () => {
    expect(
      buildVariantSkuCode(" KMJ01 ", { Warna: "light blue", Ukuran: "M" }, ["Warna", "Ukuran"]),
    ).toBe("KMJ01-LIGHTBLUE-M");
    expect(buildVariantSkuCode("KMJ01", {}, ["Warna"])).toBe("KMJ01");
    expect(buildVariantSkuCode("", { Warna: "Red" }, ["Warna"])).toBe("RED");
  });
});
