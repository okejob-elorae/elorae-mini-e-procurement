import { describe, expect, it } from "vitest";
import { evenRatios, groupVariantsByColor, type VariantAxisRow } from "./color-ratio";

const row = (variantSku: string, colorKey: string, size: string | null): VariantAxisRow => ({
  variantSku,
  colorKey,
  colorName: colorKey,
  size,
});

describe("colour-first WO ratio (#410)", () => {
  it("groups variants by colour and orders sizes like garments", () => {
    const groups = groupVariantsByColor([
      row("40-L", "black", "L"),
      row("40-M", "black", "M"),
      row("41-S", "grey", "S"),
      row("40-S", "black", "S"),
      row("40-XL", "black", "XL"),
      row("40-X", "black", null),
    ]);
    expect(groups.map((g) => g.colorKey)).toEqual(["black", "grey"]);
    expect(groups[0].variants.map((v) => v.variantSku)).toEqual(["40-S", "40-M", "40-L", "40-XL", "40-X"]);
  });

  it("splits evenly in whole percents summing to 100", () => {
    expect(evenRatios(["a", "b", "c"]).map((r) => r.ratioPercent)).toEqual([34, 33, 33]);
    expect(evenRatios([])).toEqual([]);
  });
});
