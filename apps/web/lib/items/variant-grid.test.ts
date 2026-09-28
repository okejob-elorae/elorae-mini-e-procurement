import { describe, expect, it } from "vitest";
import {
  attributesFromSavedVariants,
  cartesianCombinations,
  carryRowValues,
  comboKey,
  findSavedVariant,
  initialExcludedKeys,
  overlaySavedSpelling,
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

  it("ignores sku/barcode even when the combo itself carries them", () => {
    /* Without the reserved-key skip, comparing combo.sku against a
     * differently-spelled saved sku would fail this match. */
    const match = findSavedVariant(
      { Color: "Biru", Size: "M", sku: "combo-side-sku" },
      [{ Color: "Biru", Size: "M", sku: "saved-side-sku", barcode: "999" }]
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

describe("attributesFromSavedVariants", () => {
  it("de-duplicates a value spelled two ways, keeping the first spelling", () => {
    const saved = [
      { Warna: "Merah", Ukuran: "M", sku: "A" },
      { Warna: "merah", Ukuran: "L", sku: "B" },
      { Warna: "Biru", Ukuran: "M", sku: "C" },
      { Warna: "Biru", Ukuran: "L", sku: "D" },
    ];
    expect(attributesFromSavedVariants(saved)).toEqual([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
  });

  it("tolerates a saved variant missing an attribute key", () => {
    const saved = [{ Warna: "Merah" }, { Warna: "Biru", Ukuran: "M" }];
    expect(attributesFromSavedVariants(saved)).toEqual([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M"] },
    ]);
  });

  it("excludes sku/barcode from the attribute set", () => {
    const saved = [{ Warna: "Merah", sku: "A", barcode: "111" }];
    expect(attributesFromSavedVariants(saved)).toEqual([{ key: "Warna", values: ["Merah"] }]);
  });
});

describe("overlaySavedSpelling", () => {
  it("round-trips a twin-spelling saved grid to exactly the saved values", () => {
    const saved = [
      { Warna: "Merah", Ukuran: "M", sku: "A" },
      { Warna: "merah", Ukuran: "L", sku: "B" },
      { Warna: "Biru", Ukuran: "M", sku: "C" },
      { Warna: "Biru", Ukuran: "L", sku: "D" },
    ];
    const combos = cartesianCombinations(attributesFromSavedVariants(saved));
    const resolved = combos.map((combo) => overlaySavedSpelling(combo, saved));
    expect(resolved).toEqual([
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "merah", Ukuran: "L" },
      { Warna: "Biru", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "L" },
    ]);
  });

  it("falls back to the combo's own values when there is no saved match", () => {
    const combo = { Warna: "Hijau", Ukuran: "XL" };
    expect(overlaySavedSpelling(combo, [{ Warna: "Merah", Ukuran: "M" }])).toEqual(combo);
  });
});

describe("carryRowValues", () => {
  const attributeKeys = ["Warna", "Ukuran"];

  it("keeps every row's value on its own combination when a value is added", () => {
    const prevCombos = [{ Ukuran: "M" }, { Ukuran: "L" }];
    const prevValues = ["SKU-M", "SKU-L"];
    const nextCombos = [{ Ukuran: "M" }, { Ukuran: "L" }, { Ukuran: "XL" }];
    expect(carryRowValues(prevCombos, prevValues, nextCombos, ["Ukuran"])).toEqual([
      "SKU-M",
      "SKU-L",
      "",
    ]);
  });

  it("drops a combination's value when that value is removed", () => {
    const prevCombos = [{ Ukuran: "M" }, { Ukuran: "L" }];
    const prevValues = ["SKU-M", "SKU-L"];
    const nextCombos = [{ Ukuran: "M" }];
    expect(carryRowValues(prevCombos, prevValues, nextCombos, ["Ukuran"])).toEqual(["SKU-M"]);
  });

  it("keeps an excluded row's own SKU when rows shift position", () => {
    const prevCombos = [
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "Merah", Ukuran: "L" },
      { Warna: "Biru", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "L" },
    ];
    const prevValues = ["A", "B", "C", "D"];
    const nextCombos = [
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "Merah", Ukuran: "L" },
      { Warna: "Merah", Ukuran: "XL" },
      { Warna: "Biru", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "L" },
      { Warna: "Biru", Ukuran: "XL" },
    ];
    expect(carryRowValues(prevCombos, prevValues, nextCombos, attributeKeys)).toEqual([
      "A",
      "B",
      "",
      "C",
      "D",
      "",
    ]);
  });
});
