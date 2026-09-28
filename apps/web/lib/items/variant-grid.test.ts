import { describe, expect, it } from "vitest";
import {
  type AttributeDef,
  attributesFromSavedVariants,
  cartesianCombinations,
  carryRowValues,
  comboKey,
  contributingAttributes,
  findSavedVariant,
  initialExcludedKeys,
  isGridComplete,
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

describe("contributingAttributes", () => {
  it("keeps only a trimmed, non-empty key with at least one value", () => {
    expect(
      contributingAttributes([
        { key: "Warna", values: ["Merah"] },
        { key: "  ", values: ["X"] },
        { key: "Bahan", values: [] },
        { key: "", values: [] },
      ])
    ).toEqual([{ key: "Warna", values: ["Merah"] }]);
  });

  it("returns empty for an all-blank attribute list", () => {
    expect(contributingAttributes([{ key: "", values: [] }])).toEqual([]);
  });
});

describe("isGridComplete", () => {
  it("is true when every row is fully filled", () => {
    expect(
      isGridComplete([
        { key: "Warna", values: ["Merah", "Biru"] },
        { key: "Ukuran", values: ["M", "L"] },
      ])
    ).toBe(true);
  });

  it("is true with a freshly added blank row alongside filled rows", () => {
    expect(
      isGridComplete([
        { key: "Warna", values: ["Merah"] },
        { key: "", values: [] },
      ])
    ).toBe(true);
  });

  it("is false when a row has a key typed but no value yet", () => {
    expect(
      isGridComplete([
        { key: "Warna", values: ["Merah"] },
        { key: "Bahan", values: [] },
      ])
    ).toBe(false);
  });

  it("is false when a row has values but its key was cleared", () => {
    expect(
      isGridComplete([
        { key: "Warna", values: ["Merah"] },
        { key: "", values: ["M", "L"] },
      ])
    ).toBe(false);
  });

  it("is false when two contributing keys collide case-insensitively", () => {
    expect(
      isGridComplete([
        { key: "Warna", values: ["Merah"] },
        { key: "warna", values: ["Biru"] },
      ])
    ).toBe(false);
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
    /**
     * Without the reserved-key skip, comparing combo.sku against a
     * differently-spelled saved sku would fail this match.
     */
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
  it("keeps every row's value on its own combination when a value is added", () => {
    const keys = ["Ukuran"];
    const prevCombos = cartesianCombinations([{ key: "Ukuran", values: ["M", "L"] }]);
    const prevValues = ["SKU-M", "SKU-L"];
    const nextCombos = cartesianCombinations([{ key: "Ukuran", values: ["M", "L", "XL"] }]);
    expect(carryRowValues(prevCombos, prevValues, keys, nextCombos, keys)).toEqual([
      "SKU-M",
      "SKU-L",
      "",
    ]);
  });

  it("drops a combination's value when that value is removed", () => {
    const keys = ["Ukuran"];
    const prevCombos = cartesianCombinations([{ key: "Ukuran", values: ["M", "L"] }]);
    const prevValues = ["SKU-M", "SKU-L"];
    const nextCombos = cartesianCombinations([{ key: "Ukuran", values: ["M"] }]);
    expect(carryRowValues(prevCombos, prevValues, keys, nextCombos, keys)).toEqual(["SKU-M"]);
  });

  it("carries values by combination identity when rows shift position", () => {
    const keys = ["Warna", "Ukuran"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L", "XL"] },
    ]);
    expect(carryRowValues(prevCombos, prevValues, keys, nextCombos, keys)).toEqual([
      "A",
      "B",
      "",
      "C",
      "D",
      "",
    ]);
  });

  it("carries every SKU when an added attribute has a single value", () => {
    const prevKeys = ["Warna", "Ukuran"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextKeys = ["Warna", "Ukuran", "Bahan"];
    const nextCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
      { key: "Bahan", values: ["Katun"] },
    ]);
    expect(carryRowValues(prevCombos, prevValues, prevKeys, nextCombos, nextKeys)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("blanks every row when an added attribute has two values, never duplicating a SKU", () => {
    const prevKeys = ["Warna", "Ukuran"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextKeys = ["Warna", "Ukuran", "Bahan"];
    const nextCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
      { key: "Bahan", values: ["Katun", "Sutra"] },
    ]);
    expect(carryRowValues(prevCombos, prevValues, prevKeys, nextCombos, nextKeys)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("carries every SKU by position when an attribute key is renamed", () => {
    const prevKeys = ["Warna", "Ukuran"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextKeys = ["Warna", "Size"];
    const nextCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Size", values: ["M", "L"] },
    ]);
    expect(carryRowValues(prevCombos, prevValues, prevKeys, nextCombos, nextKeys)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("carries every SKU when removing an attribute whose value was constant", () => {
    const prevKeys = ["Warna", "Ukuran", "Bahan"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
      { key: "Bahan", values: ["Katun"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextKeys = ["Warna", "Ukuran"];
    const nextCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    expect(carryRowValues(prevCombos, prevValues, prevKeys, nextCombos, nextKeys)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("blanks every row when removing an attribute collapses two rows into one", () => {
    const prevKeys = ["Warna", "Ukuran"];
    const prevCombos = cartesianCombinations([
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ]);
    const prevValues = ["A", "B", "C", "D"];
    const nextKeys = ["Warna"];
    const nextCombos = cartesianCombinations([{ key: "Warna", values: ["Merah", "Biru"] }]);
    expect(carryRowValues(prevCombos, prevValues, prevKeys, nextCombos, nextKeys)).toEqual([
      "",
      "",
    ]);
  });
});

/**
 * Simulates the SAME last-complete-grid snapshot rule `ItemForm` runs on
 * every combinations change: carry from the last COMPLETE grid (never the
 * merely-previous one), then advance the snapshot only when this grid is
 * also complete. No saved-variant matching here — these sequences are about
 * the carrying algorithm alone, not `findSavedVariant`.
 */
type GridSnapshot = {
  combos: Array<Record<string, string>>;
  keys: string[];
  skus: string[];
};

function advanceGrid(
  snapshot: GridSnapshot,
  attributes: AttributeDef[]
): { skus: string[]; snapshot: GridSnapshot } {
  const combos = cartesianCombinations(attributes);
  const keys = contributingAttributes(attributes).map((attr) => attr.key);
  const skus =
    combos.length === 0
      ? []
      : carryRowValues(snapshot.combos, snapshot.skus, snapshot.keys, combos, keys);
  const nextSnapshot = isGridComplete(attributes) ? { combos, keys, skus } : snapshot;
  return { skus, snapshot: nextSnapshot };
}

describe("carrying across a live-typing sequence", () => {
  it("carries all four SKUs through a name-first attribute add (name, then value)", () => {
    const baseAttributes: AttributeDef[] = [
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ];
    let snapshot: GridSnapshot = {
      combos: cartesianCombinations(baseAttributes),
      keys: contributingAttributes(baseAttributes).map((attr) => attr.key),
      skus: ["A", "B", "C", "D"],
    };

    let result = advanceGrid(snapshot, [...baseAttributes, { key: "", values: [] }]);
    snapshot = result.snapshot;
    expect(result.skus).toEqual(["A", "B", "C", "D"]);

    result = advanceGrid(snapshot, [...baseAttributes, { key: "Bahan", values: [] }]);
    snapshot = result.snapshot;
    expect(result.skus).toEqual(["A", "B", "C", "D"]);

    result = advanceGrid(snapshot, [...baseAttributes, { key: "Bahan", values: ["Katun"] }]);
    expect(result.skus).toEqual(["A", "B", "C", "D"]);
  });

  it("blanks while a rename passes through an empty key, then restores every SKU", () => {
    const baseAttributes: AttributeDef[] = [
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M", "L"] },
    ];
    let snapshot: GridSnapshot = {
      combos: cartesianCombinations(baseAttributes),
      keys: contributingAttributes(baseAttributes).map((attr) => attr.key),
      skus: ["A", "B", "C", "D"],
    };

    let result = advanceGrid(snapshot, [
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "", values: ["M", "L"] },
    ]);
    snapshot = result.snapshot;
    expect(result.skus).toEqual(["", ""]);

    result = advanceGrid(snapshot, [
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Size", values: ["M", "L"] },
    ]);
    expect(result.skus).toEqual(["A", "B", "C", "D"]);
  });
});
