import { describe, expect, it } from "vitest";
import {
  type AttributeDef,
  type GridRows,
  type GridState,
  EMPTY_GRID_ROWS,
  attributesFromSavedVariants,
  cartesianCombinations,
  carryRowValues,
  comboKey,
  contributingAttributes,
  findSavedVariant,
  initialExcludedKeys,
  isGridComplete,
  isSameGrid,
  mapRowValues,
  overlaySavedSpelling,
  resolveGridRows,
  setRowValueAt,
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

describe("isSameGrid", () => {
  const rows = (keys: string[], attributes: AttributeDef[]): GridRows => ({
    combos: cartesianCombinations(attributes),
    keys,
    skus: [],
    barcodes: [],
  });

  it("is true for the same keys and the same combinations", () => {
    const attributes = [
      { key: "Warna", values: ["Merah", "Biru"] },
      { key: "Ukuran", values: ["M"] },
    ];
    const a = rows(["Warna", "Ukuran"], attributes);
    const b = rows(["Warna", "Ukuran"], attributes);
    expect(isSameGrid(a, b)).toBe(true);
  });

  it("is false when a key is renamed", () => {
    expect(
      isSameGrid(
        rows(["Warna", "Ukuran"], [
          { key: "Warna", values: ["Merah"] },
          { key: "Ukuran", values: ["M"] },
        ]),
        rows(["Warna", "Size"], [
          { key: "Warna", values: ["Merah"] },
          { key: "Size", values: ["M"] },
        ])
      )
    ).toBe(false);
  });

  it("is false when the combinations differ", () => {
    expect(
      isSameGrid(
        rows(["Warna"], [{ key: "Warna", values: ["Merah", "Biru"] }]),
        rows(["Warna"], [{ key: "Warna", values: ["Merah", "Hijau"] }])
      )
    ).toBe(false);
  });
});

/**
 * The two ways `ItemForm` calls `resolveGridRows`: its lazy mount
 * initializer (`mount`) and `commitAttributes` on every attribute edit
 * (`commit`). These wrappers only pass arguments through. Code edits call
 * `setRowValueAt` / `mapRowValues` directly, as the form's SKU and barcode
 * handlers do.
 */
function mount(attributes: AttributeDef[], savedVariants: Array<Record<string, string>>): GridState {
  return resolveGridRows({
    attributes,
    savedVariants,
    rows: EMPTY_GRID_ROWS,
    snapshot: EMPTY_GRID_ROWS,
  });
}

function commit(
  state: GridState,
  attributes: AttributeDef[],
  savedVariants: Array<Record<string, string>>
): GridState {
  return resolveGridRows({
    attributes,
    savedVariants,
    rows: state.rows,
    snapshot: state.snapshot,
  });
}

const SAVED = [
  { Warna: "Merah", Ukuran: "M", sku: "A", barcode: "1" },
  { Warna: "Merah", Ukuran: "L", sku: "B", barcode: "2" },
  { Warna: "Biru", Ukuran: "M", sku: "C", barcode: "3" },
  { Warna: "Biru", Ukuran: "L", sku: "D", barcode: "4" },
];

const WARNA: AttributeDef = { key: "Warna", values: ["Merah", "Biru"] };

describe("resolveGridRows", () => {
  it("resolves an item with no attributes to no rows", () => {
    expect(mount([], []).rows).toEqual(EMPTY_GRID_ROWS);
  });

  it("prefills every saved code on mount and snapshots the complete grid", () => {
    const state = mount(attributesFromSavedVariants(SAVED), SAVED);
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    expect(state.rows.barcodes).toEqual(["1", "2", "3", "4"]);
    expect(state.snapshot).toBe(state.rows);
  });

  it("carries all four saved SKUs through a name-first attribute add (Bahan, then Katun)", () => {
    const ukuran: AttributeDef = { key: "Ukuran", values: ["M", "L"] };
    let state = mount(attributesFromSavedVariants(SAVED), SAVED);

    state = commit(state, [WARNA, ukuran, { key: "", values: [] }], SAVED);
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);

    state = commit(state, [WARNA, ukuran, { key: "Bahan", values: [] }], SAVED);
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);

    state = commit(state, [WARNA, ukuran, { key: "Bahan", values: ["Katun"] }], SAVED);
    expect(state.rows.keys).toEqual(["Warna", "Ukuran", "Bahan"]);
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    expect(state.rows.barcodes).toEqual(["1", "2", "3", "4"]);
  });

  it("restores all four SKUs after a backspace-rename Ukuran → '' → 'Size'", () => {
    let state = mount(attributesFromSavedVariants(SAVED), SAVED);
    const renameTo = (key: string) =>
      commit(state, [WARNA, { key, values: ["M", "L"] }], SAVED);

    ["Ukura", "Ukur", "Uku", "Uk", "U"].forEach((key) => {
      state = renameTo(key);
      expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    });

    /**
     * With the name empty only Warna contributes, so the form shows two rows,
     * each prefilled from the FIRST saved variant of that colour — a
     * partial saved match, not a carry.
     */
    state = renameTo("");
    expect(state.rows.combos).toEqual([{ Warna: "Merah" }, { Warna: "Biru" }]);
    expect(state.rows.skus).toEqual(["A", "C"]);

    ["S", "Si", "Siz", "Size"].forEach((key) => {
      state = renameTo(key);
      expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    });
    expect(state.rows.barcodes).toEqual(["1", "2", "3", "4"]);
  });

  it("blanks while a rename collides with another attribute's name, then restores once unique", () => {
    let state = mount(attributesFromSavedVariants(SAVED), SAVED);
    const renameTo = (key: string) =>
      commit(state, [WARNA, { key, values: ["M", "L"] }], SAVED);

    ["W", "Wa", "War", "Warn"].forEach((key) => {
      state = renameTo(key);
      expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    });

    state = renameTo("Warna");
    expect(state.rows.skus).toEqual(["", "", "", ""]);

    state = renameTo("Warna2");
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
  });

  it("restores typed codes after the last value is removed and added back under the same name", () => {
    let state = mount([WARNA, { key: "Ukuran", values: ["M"] }], []);
    state = setRowValueAt(state, "skus", 0, "X");
    state = setRowValueAt(state, "skus", 1, "Y");

    state = commit(state, [WARNA, { key: "Ukuran", values: [] }], []);
    expect(state.rows.combos).toEqual([{ Warna: "Merah" }, { Warna: "Biru" }]);
    expect(state.rows.skus).toEqual(["X", "Y"]);

    state = commit(state, [WARNA, { key: "Ukuran", values: ["M"] }], []);
    expect(state.rows.combos).toEqual([
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "M" },
    ]);
    expect(state.rows.skus).toEqual(["X", "Y"]);
  });

  it("keeps codes typed while a name-only attribute row exists once its value is added", () => {
    const ukuran: AttributeDef = { key: "Ukuran", values: ["M", "L"] };
    let state = mount([WARNA, ukuran], []);
    state = commit(state, [WARNA, ukuran, { key: "", values: [] }], []);
    state = commit(state, [WARNA, ukuran, { key: "Bahan", values: [] }], []);

    ["S1", "S2", "S3", "S4"].forEach((sku, i) => {
      state = setRowValueAt(state, "skus", i, sku);
    });
    state = setRowValueAt(state, "barcodes", 2, "BC3");

    state = commit(state, [WARNA, ukuran, { key: "Bahan", values: ["Katun"] }], []);
    expect(state.rows.skus).toEqual(["S1", "S2", "S3", "S4"]);
    expect(state.rows.barcodes).toEqual(["", "", "BC3", ""]);
  });

  it("keeps codes generated while a name-only attribute row exists once that row is deleted", () => {
    const ukuran: AttributeDef = { key: "Ukuran", values: ["M", "L"] };
    let state = mount([WARNA, ukuran], []);
    state = commit(state, [WARNA, ukuran, { key: "Bahan", values: [] }], []);

    state = mapRowValues(state, "skus", (combo) => `GEN-${combo.Warna}-${combo.Ukuran}`);

    state = commit(state, [WARNA, ukuran], []);
    expect(state.rows.skus).toEqual(["GEN-Merah-M", "GEN-Merah-L", "GEN-Biru-M", "GEN-Biru-L"]);
  });

  it("round-trips twin saved spellings, including after a value is added", () => {
    const twins = [
      { Warna: "Merah", Ukuran: "M", sku: "A" },
      { Warna: "merah", Ukuran: "L", sku: "B" },
      { Warna: "Biru", Ukuran: "M", sku: "C" },
      { Warna: "Biru", Ukuran: "L", sku: "D" },
    ];
    let state = mount(attributesFromSavedVariants(twins), twins);
    expect(state.rows.skus).toEqual(["A", "B", "C", "D"]);
    expect(state.rows.combos.map((combo) => overlaySavedSpelling(combo, twins))).toEqual([
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "merah", Ukuran: "L" },
      { Warna: "Biru", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "L" },
    ]);

    state = commit(state, [WARNA, { key: "Ukuran", values: ["M", "L", "XL"] }], twins);
    expect(state.rows.skus).toEqual(["A", "B", "", "C", "D", ""]);
    expect(state.rows.combos.map((combo) => overlaySavedSpelling(combo, twins))).toEqual([
      { Warna: "Merah", Ukuran: "M" },
      { Warna: "merah", Ukuran: "L" },
      { Warna: "Merah", Ukuran: "XL" },
      { Warna: "Biru", Ukuran: "M" },
      { Warna: "Biru", Ukuran: "L" },
      { Warna: "Biru", Ukuran: "XL" },
    ]);
  });

  it("keeps each SKU and exclusion on its own combination when a saved 2×2 unticks Biru/M and adds XL", () => {
    let state = mount(attributesFromSavedVariants(SAVED), SAVED);
    expect(state.rows.combos[2]).toEqual({ Warna: "Biru", Ukuran: "M" });
    const excluded = new Set([comboKey(state.rows.combos[2], state.rows.keys)]);

    state = commit(state, [WARNA, { key: "Ukuran", values: ["M", "L", "XL"] }], SAVED);
    const current = state.rows;
    expect(
      current.combos.map((combo, i) => ({
        combo,
        sku: current.skus[i],
        excluded: excluded.has(comboKey(combo, current.keys)),
      }))
    ).toEqual([
      { combo: { Warna: "Merah", Ukuran: "M" }, sku: "A", excluded: false },
      { combo: { Warna: "Merah", Ukuran: "L" }, sku: "B", excluded: false },
      { combo: { Warna: "Merah", Ukuran: "XL" }, sku: "", excluded: false },
      { combo: { Warna: "Biru", Ukuran: "M" }, sku: "C", excluded: true },
      { combo: { Warna: "Biru", Ukuran: "L" }, sku: "D", excluded: false },
      { combo: { Warna: "Biru", Ukuran: "XL" }, sku: "", excluded: false },
    ]);
  });
});

describe("mapRowValues / setRowValueAt", () => {
  it("rewrites one column against the state's own combinations and leaves the snapshot", () => {
    const state = mount([WARNA], []);
    const next = mapRowValues(state, "barcodes", (combo, _value, i) => `${combo.Warna}-${i}`);
    expect(next.rows.barcodes).toEqual(["Merah-0", "Biru-1"]);
    expect(next.rows.skus).toEqual(["", ""]);
    expect(next.snapshot).toBe(state.snapshot);
  });

  it("ignores an index outside the current rows", () => {
    const state = mount([WARNA], []);
    expect(setRowValueAt(state, "skus", 5, "X").rows.skus).toEqual(["", ""]);
  });
});
