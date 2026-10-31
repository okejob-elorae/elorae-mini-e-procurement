import { describe, expect, it } from "vitest";
import { buildColorIndex } from "@elorae/db/variant-axes";
import {
  buildVariantSkuCode,
  replaceColorLabel,
  unknownVariantColors,
  validateAndNormalizeVariants,
} from "./normalize-variants";
import { DuplicateVariantBarcodeError, DuplicateVariantSkuError } from "./save-refusals";

describe("validateAndNormalizeVariants", () => {
  const variants = [
    { Warna: "Merah", Ukuran: "M", sku: "" },
    { Warna: "Biru Muda", Ukuran: "L", sku: "" },
  ];

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

  it("leaves a fabric colour's Pantone code out of a generated SKU", () => {
    const out = validateAndNormalizeVariants("KAIN-01", [{ warna: "Hitam", pantone: "19-4005 TCX", sku: "" }]);
    expect(out).toEqual([{ warna: "Hitam", pantone: "19-4005 TCX", sku: "KAIN-01-HITAM" }]);
  });

  it("refuses duplicate variant SKUs and barcodes case-insensitively", () => {
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-X" }, { sku: "A-x" }], {}),
    ).toThrow("Duplicate variant SKU");
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-1", barcode: "X1" }, { sku: "A-2", barcode: "x1" }], {}),
    ).toThrow("Duplicate variant barcode");
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-X" }, { sku: "A-x" }], {}),
    ).toThrow(DuplicateVariantSkuError);
    expect(() =>
      validateAndNormalizeVariants("A", [{ sku: "A-1", barcode: "X1" }, { sku: "A-2", barcode: "x1" }], {}),
    ).toThrow(DuplicateVariantBarcodeError);
  });

  it("refuses duplicate variant SKUs and barcodes that differ only by an accent, as the collation does", () => {
    expect(() =>
      validateAndNormalizeVariants("X", [{ sku: "X-MERAH" }, { sku: "X-MÉRAH" }], {}),
    ).toThrow("Duplicate variant SKU");
    expect(() =>
      validateAndNormalizeVariants("X", [{ sku: "X-1", barcode: "CAFE1" }, { sku: "X-2", barcode: "CAFÉ1" }], {}),
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

  it("builds the variant code as {base}-{slugs} in attribute order", () => {
    expect(
      buildVariantSkuCode(" KMJ01 ", { Warna: "light blue", Ukuran: "M" }, ["Warna", "Ukuran"]),
    ).toBe("KMJ01-LIGHTBLUE-M");
    expect(buildVariantSkuCode("KMJ01", {}, ["Warna"])).toBe("KMJ01");
    expect(buildVariantSkuCode("", { Warna: "Red" }, ["Warna"])).toBe("RED");
  });
});

describe("validateAndNormalizeVariants with fixedAxes (#437)", () => {
  it("stores colour/size spellings as Warna/Ukuran", () => {
    expect(
      validateAndNormalizeVariants("FG1", [{ Color: "Red", size: "S", sku: "FG1-RED-S" }], { fixedAxes: true }),
    ).toEqual([{ Warna: "Red", Ukuran: "S", sku: "FG1-RED-S" }]);
  });

  it("does not count a Pantone code as a third axis", () => {
    expect(
      validateAndNormalizeVariants("FG1", [{ Warna: "Red", pantone: "19-1664 TCX", sku: "FG1-RED" }], { fixedAxes: true }),
    ).toEqual([{ Warna: "Red", pantone: "19-1664 TCX", sku: "FG1-RED" }]);
  });

  it("refuses an attribute other than colour and size", () => {
    expect(() =>
      validateAndNormalizeVariants("FG1", [{ Warna: "Red", Motif: "Polka", sku: "FG1-RED" }], { fixedAxes: true }),
    ).toThrow('Finished-good variants may only have Warna (colour) and Ukuran (size); found "Motif"');
  });

  it("leaves other attributes alone without the option", () => {
    expect(validateAndNormalizeVariants("A1", [{ Motif: "Polka", sku: "A1-POLKA" }])).toEqual([
      { Motif: "Polka", sku: "A1-POLKA" },
    ]);
  });
});

describe("unknownVariantColors", () => {
  const index = buildColorIndex([{ id: "c1", name: "Army", aliases: ["Hijau Army"] }]);

  it("lists colours no master colour spells, once each", () => {
    const out = unknownVariantColors(
      [{ Warna: "army", Ukuran: "M" }, { Warna: "Hijau Army" }, { Warna: "Dark Navy" }, { Color: "Dark Navy", Size: "L" }],
      index,
    );
    expect(out).toEqual(["Dark Navy"]);
  });

  it("reports one entry per spelling and skips variants without a colour", () => {
    expect(unknownVariantColors([{ Ukuran: "M" }, { Warna: "Navy" }, { Warna: " navy " }], index)).toEqual(["Navy"]);
  });

  it("grandfathers a colour saved under a legacy axis key", () => {
    expect(unknownVariantColors([{ Warna: "Teal" }], index, [{ Color: "teal", Size: "M" }])).toEqual([]);
  });

  it("lets through a colour the item already carried", () => {
    expect(unknownVariantColors([{ Warna: "Dark Navy" }, { Warna: "Cream" }], index, [{ Warna: "dark navy" }])).toEqual([
      "Cream",
    ]);
  });
});

describe("replaceColorLabel", () => {
  it("swaps the label and drops a duplicate spelling it creates", () => {
    expect(replaceColorLabel(["Dark Navy", "navy", "Cream"], "Dark Navy", "Navy")).toEqual(["Navy", "Cream"]);
  });
});
