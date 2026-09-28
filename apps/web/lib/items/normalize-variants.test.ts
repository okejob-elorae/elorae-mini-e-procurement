import { describe, expect, it } from "vitest";
import { validateAndNormalizeVariants } from "./normalize-variants";

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
      validateAndNormalizeVariants("A", [{ sku: "A-1" }, { sku: "a-1" }], {}),
    ).toThrow("Duplicate variant SKU");
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-1", barcode: "X1" }, { sku: "A-2", barcode: "x1" }], {}),
    ).toThrow("Duplicate variant barcode");
  });

  it("returns an empty list for no variants", () => {
    expect(validateAndNormalizeVariants("A", undefined)).toEqual([]);
  });
});
