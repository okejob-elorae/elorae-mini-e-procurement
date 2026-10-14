import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { buildColorIndex } from "@elorae/db/variant-axes";
import {
  ScopedBomNeedsVariantsError,
  buildVariantMix,
  equalVariantMix,
  findOverlappingRules,
  planMaterialQuantities,
  unresolvedMixVariants,
  type ScopedRule,
} from "./scoped-bom";

const index = buildColorIndex([
  { id: "black", name: "Black", aliases: [] },
  { id: "grey", name: "Grey", aliases: ["Gray"] },
]);
const variants = [
  { sku: "P-BLK-S", Warna: "Black", Ukuran: "S" },
  { sku: "P-BLK-M", Warna: "Black", Ukuran: "M" },
  { sku: "P-GRY-S", Warna: "Gray", Ukuran: "S" },
  { sku: "P-GRY-M", Warna: "Grey", Ukuran: "M" },
];

function rule(materialId: string, qty: number, scope: Partial<ScopedRule> = {}): ScopedRule {
  return { materialId, qtyRequired: qty, wastePercent: 0, colorId: null, size: null, ...scope };
}

describe("planMaterialQuantities", () => {
  const mix = buildVariantMix(new Decimal(100), [
    { variantSku: "P-BLK-S", ratioPercent: 40 },
    { variantSku: "P-BLK-M", ratioPercent: 20 },
    { variantSku: "P-GRY-S", ratioPercent: 30 },
    { variantSku: "P-GRY-M", ratioPercent: 10 },
  ], variants, index);

  it("applies an unscoped rule to the whole output", () => {
    const plan = planMaterialQuantities([rule("thread", 2, { wastePercent: 10 })], new Decimal(100), mix);
    expect(plan.get("thread")?.plannedQty.toNumber()).toBeCloseTo(220);
  });

  it("applies a colour rule only to that colour's variants", () => {
    const plan = planMaterialQuantities(
      [rule("fabricX", 1.5, { colorId: "black" }), rule("fabricY", 1.5, { colorId: "grey" })],
      new Decimal(100),
      mix,
    );
    expect(plan.get("fabricX")?.plannedQty.toNumber()).toBeCloseTo(90);
    expect(plan.get("fabricY")?.plannedQty.toNumber()).toBeCloseTo(60);
  });

  it("applies a size rule across colours and a colour+size rule to one variant", () => {
    const plan = planMaterialQuantities(
      [rule("labelS", 1, { size: "s" }), rule("tag", 2, { colorId: "grey", size: "M" })],
      new Decimal(100),
      mix,
    );
    expect(plan.get("labelS")?.plannedQty.toNumber()).toBe(70);
    expect(plan.get("tag")?.plannedQty.toNumber()).toBe(20);
  });

  it("sums one material's non-overlapping rules and drops a scope no variant needs", () => {
    const blackOnly = buildVariantMix(new Decimal(10), { variantSku: "P-BLK-S" }, variants, index);
    const plan = planMaterialQuantities(
      [rule("fabricX", 1, { colorId: "black", size: "S" }), rule("fabricX", 2, { colorId: "black", size: "M" }), rule("fabricY", 1, { colorId: "grey" })],
      new Decimal(10),
      blackOnly,
    );
    expect(plan.get("fabricX")?.plannedQty.toNumber()).toBe(10);
    expect(plan.has("fabricY")).toBe(false);
  });

  it("refuses a scoped BOM without a variant mix", () => {
    expect(() => planMaterialQuantities([rule("fabricX", 1, { colorId: "black" })], new Decimal(5), null)).toThrow(
      ScopedBomNeedsVariantsError,
    );
    expect(planMaterialQuantities([rule("thread", 1)], new Decimal(5), null).get("thread")?.plannedQty.toNumber()).toBe(5);
  });

  it("keeps an unscoped material at zero output", () => {
    expect(planMaterialQuantities([rule("thread", 1)], new Decimal(0), null).get("thread")?.plannedQty.toNumber()).toBe(0);
  });
});

describe("variant mix helpers", () => {
  it("splits evenly and reports variants whose colour or size cannot be resolved", () => {
    const withUnknown = [...variants, { sku: "P-MAU-S", Warna: "Mauve", Ukuran: "S" }];
    const mix = equalVariantMix(new Decimal(50), withUnknown, index);
    expect(mix.map((m) => m.qty.toNumber())).toEqual([10, 10, 10, 10, 10]);
    expect(unresolvedMixVariants([rule("fabricX", 1, { colorId: "black" })], mix)).toEqual(["P-MAU-S"]);
    expect(unresolvedMixVariants([rule("labelS", 1, { size: "S" })], mix)).toEqual([]);
    expect(unresolvedMixVariants([rule("thread", 1)], mix)).toEqual([]);
  });
});

describe("findOverlappingRules", () => {
  it("flags two rules of one material that can both match a variant", () => {
    expect(findOverlappingRules([rule("x", 1), rule("x", 1, { colorId: "black" })])).toEqual([[0, 1]]);
    expect(findOverlappingRules([rule("x", 1, { size: "S" }), rule("x", 1, { colorId: "black" })])).toEqual([[0, 1]]);
    expect(findOverlappingRules([rule("x", 1, { size: "s" }), rule("x", 1, { size: "S" })])).toEqual([[0, 1]]);
  });

  it("allows disjoint scopes and different materials", () => {
    expect(findOverlappingRules([rule("x", 1, { colorId: "black" }), rule("x", 1, { colorId: "grey" })])).toEqual([]);
    expect(findOverlappingRules([rule("x", 1, { size: "S" }), rule("x", 1, { size: "M" })])).toEqual([]);
    expect(findOverlappingRules([rule("x", 1), rule("y", 1)])).toEqual([]);
  });
});
