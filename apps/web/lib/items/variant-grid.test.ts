import { describe, expect, it } from "vitest";
import {
  cartesianCombinations,
  comboKey,
  findSavedVariant,
  initialExcludedKeys,
} from "./variant-grid";

describe("cartesianCombinations", () => {
  it("returns empty for no attributes", () => {
    expect(cartesianCombinations([])).toEqual([]);
  });

  it("skips attributes with an empty key or no values", () => {
    expect(
      cartesianCombinations([
        { key: "", values: ["Red"] },
        { key: "Size", values: [] },
      ])
    ).toEqual([]);
  });

  it("builds the full cartesian product in attribute-then-value order", () => {
    expect(
      cartesianCombinations([
        { key: "Color", values: ["Merah", "Biru"] },
        { key: "Size", values: ["M", "L"] },
      ])
    ).toEqual([
      { Color: "Merah", Size: "M" },
      { Color: "Merah", Size: "L" },
      { Color: "Biru", Size: "M" },
      { Color: "Biru", Size: "L" },
    ]);
  });

  it("carries a single attribute through untouched", () => {
    expect(cartesianCombinations([{ key: "Size", values: ["M", "L"] }])).toEqual([
      { Size: "M" },
      { Size: "L" },
    ]);
  });

  it("mixes a valid attribute with an invalid sibling", () => {
    expect(
      cartesianCombinations([
        { key: "Color", values: ["Merah"] },
        { key: "Size", values: [] },
      ])
    ).toEqual([{ Color: "Merah" }]);
  });
});

describe("comboKey", () => {
  it("normalizes case and whitespace", () => {
    const a = comboKey({ Color: "  Merah ", Size: "m" }, ["Color", "Size"]);
    const b = comboKey({ Color: "merah", Size: " M" }, ["Color", "Size"]);
    expect(a).toBe(b);
  });

  it("is sensitive to attribute order", () => {
    const a = comboKey({ Color: "Merah", Size: "M" }, ["Color", "Size"]);
    const b = comboKey({ Color: "Merah", Size: "M" }, ["Size", "Color"]);
    expect(a).not.toBe(b);
  });

  it("distinguishes different values on the same attribute", () => {
    const a = comboKey({ Color: "Merah" }, ["Color"]);
    const b = comboKey({ Color: "Biru" }, ["Color"]);
    expect(a).not.toBe(b);
  });
});

describe("findSavedVariant", () => {
  const savedVariants = [
    { Color: " Merah ", Size: "M", sku: "SKU-1", barcode: "111" },
    { Color: "Biru", Size: "M", sku: "SKU-2" },
  ];

  it("matches case-insensitively and trims whitespace", () => {
    const match = findSavedVariant({ Color: "merah", Size: " m " }, savedVariants);
    expect(match?.sku).toBe("SKU-1");
  });

  it("ignores sku/barcode when comparing", () => {
    const match = findSavedVariant(
      { Color: "Biru", Size: "M" },
      [{ Color: "Biru", Size: "M", sku: "whatever", barcode: "whatever" }]
    );
    expect(match).toBeDefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findSavedVariant({ Color: "Hijau", Size: "M" }, savedVariants)).toBeUndefined();
  });
});

describe("initialExcludedKeys", () => {
  const attributeKeys = ["Color", "Size"];

  it("excludes nothing when there are no saved variants", () => {
    const combinations = cartesianCombinations([
      { key: "Color", values: ["Merah", "Biru"] },
      { key: "Size", values: ["M", "L"] },
    ]);
    expect(initialExcludedKeys(combinations, [], attributeKeys)).toEqual(new Set());
  });

  it("excludes only the combination missing from a sparse saved grid", () => {
    const combinations = cartesianCombinations([
      { key: "Color", values: ["Merah", "Biru"] },
      { key: "Size", values: ["M", "L"] },
    ]);
    const savedVariants = [
      { Color: "Merah", Size: "M" },
      { Color: "Merah", Size: "L" },
      { Color: "Biru", Size: "M" },
    ];
    const excluded = initialExcludedKeys(combinations, savedVariants, attributeKeys);
    expect(excluded).toEqual(new Set([comboKey({ Color: "Biru", Size: "L" }, attributeKeys)]));
  });

  it("excludes nothing when every combination has a saved match", () => {
    const combinations = cartesianCombinations([
      { key: "Color", values: ["Merah", "Biru"] },
      { key: "Size", values: ["M", "L"] },
    ]);
    const savedVariants = [
      { Color: "Merah", Size: "M" },
      { Color: "Merah", Size: "L" },
      { Color: "Biru", Size: "M" },
      { Color: "Biru", Size: "L" },
    ];
    expect(initialExcludedKeys(combinations, savedVariants, attributeKeys)).toEqual(new Set());
  });
});
