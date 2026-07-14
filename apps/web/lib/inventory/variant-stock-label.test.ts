import { describe, expect, it } from "vitest";
import {
  buildVariantStockChips,
  resolveVariantStockLabel,
} from "./variant-stock-label";

describe("resolveVariantStockLabel", () => {
  it("prefers size from Item.variants over sku (and over color)", () => {
    expect(
      resolveVariantStockLabel("FG-001-M", [
        { sku: "FG-001-M", size: "M", color: "Black" },
      ]),
    ).toBe("M");
  });

  it("returns size alone when color is missing", () => {
    expect(
      resolveVariantStockLabel("FG-001-L", [{ sku: "FG-001-L", Size: "L" }]),
    ).toBe("L");
  });

  it("falls back to variantSku when Item.variants is missing or unmatched", () => {
    expect(resolveVariantStockLabel("FG-001-S", null)).toBe("FG-001-S");
    expect(resolveVariantStockLabel("FG-001-S", [])).toBe("FG-001-S");
    expect(
      resolveVariantStockLabel("FG-001-S", [{ sku: "OTHER", size: "S" }]),
    ).toBe("FG-001-S");
  });
});

describe("buildVariantStockChips", () => {
  const itemVariants = [
    { sku: "A-S", size: "S" },
    { sku: "A-M", size: "M" },
    { sku: "A-L", size: "L" },
    { sku: "A-XL", size: "XL" },
  ];

  it("drops empty/null/blank variantSku rows", () => {
    const chips = buildVariantStockChips(
      [
        { variantSku: null, qtyOnHand: 10, reservedQty: 0 },
        { variantSku: "", qtyOnHand: 5, reservedQty: 0 },
        { variantSku: "  ", qtyOnHand: 1, reservedQty: 0 },
        { variantSku: "A-M", qtyOnHand: 3, reservedQty: 1 },
      ],
      itemVariants,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      variantSku: "A-M",
      available: 2,
      label: "M",
    });
  });

  it("sorts by apparel size order S/M/L/XL", () => {
    const chips = buildVariantStockChips(
      [
        { variantSku: "A-XL", qtyOnHand: 1, reservedQty: 0 },
        { variantSku: "A-S", qtyOnHand: 2, reservedQty: 0 },
        { variantSku: "A-L", qtyOnHand: 3, reservedQty: 0 },
        { variantSku: "A-M", qtyOnHand: 4, reservedQty: 0 },
      ],
      itemVariants,
    );
    expect(chips.map((c) => c.label)).toEqual(["S", "M", "L", "XL"]);
  });

  it("puts known sizes before arbitrary labels", () => {
    const chips = buildVariantStockChips(
      [
        { variantSku: "A-ZZ", qtyOnHand: 1, reservedQty: 0 },
        { variantSku: "A-M", qtyOnHand: 2, reservedQty: 0 },
      ],
      [...itemVariants, { sku: "A-ZZ", size: "Custom" }],
    );
    expect(chips.map((c) => c.label)).toEqual(["M", "Custom"]);
  });

  it("returns length 0 or 1 for variantless / single-variant (UI hides matrix)", () => {
    expect(
      buildVariantStockChips(
        [{ variantSku: "", qtyOnHand: 10, reservedQty: 0 }],
        null,
      ),
    ).toHaveLength(0);

    expect(
      buildVariantStockChips(
        [{ variantSku: "ONLY-ONE", qtyOnHand: 4, reservedQty: 1 }],
        null,
      ),
    ).toHaveLength(1);
  });
});
