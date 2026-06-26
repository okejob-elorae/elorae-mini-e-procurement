import { describe, expect, it } from "vitest";
import {
  PLAN_TOLERANCE_PERCENT,
  buildCategoryApplyPlan,
  computeCategoryTotalQty,
  computeForecastChildShares,
  computeManualSharePercent,
  groupSuggestionsByCategory,
  suggestItemAction,
  type PlanBridgeChild,
  type SelectedApplyItem,
} from "./plan-bridge";

describe("groupSuggestionsByCategory", () => {
  it("groups items by itemCategoryId", () => {
    const items = [
      { itemCategoryId: "cat-a", itemId: "i1" },
      { itemCategoryId: "cat-a", itemId: "i2" },
      { itemCategoryId: "cat-b", itemId: "i3" },
    ];
    const grouped = groupSuggestionsByCategory(items);
    expect(grouped.get("cat-a")).toHaveLength(2);
    expect(grouped.get("cat-b")).toHaveLength(1);
  });

  it("skips rows without itemCategoryId", () => {
    const items = [
      { itemCategoryId: "cat-a", itemId: "i1" },
      { itemCategoryId: null, itemId: "i2" },
    ];
    const grouped = groupSuggestionsByCategory(items);
    expect(grouped.size).toBe(1);
    expect(grouped.has("cat-a")).toBe(true);
  });
});

describe("computeCategoryTotalQty", () => {
  it("sums adjusted quantities", () => {
    expect(
      computeCategoryTotalQty([
        { adjustedQty: 100 },
        { adjustedQty: 250 },
        { adjustedQty: 50 },
      ])
    ).toBe(400);
  });
});

describe("computeForecastChildShares", () => {
  it("gives single item the full share pool", () => {
    expect(computeForecastChildShares([500], 90)).toEqual([90]);
  });

  it("splits proportionally across multiple items", () => {
    const shares = computeForecastChildShares([100, 200], 90);
    expect(shares).toEqual([30, 60]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(90);
  });

  it("uses last-item remainder so shares sum exactly to pool", () => {
    const shares = computeForecastChildShares([1, 1, 1], 100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares[0]).toBeCloseTo(33.33, 1);
    expect(shares[2]).toBeCloseTo(33.34, 1);
  });

  it("returns empty array for zero quantities", () => {
    expect(computeForecastChildShares([], 50)).toEqual([]);
  });
});

describe("computeManualSharePercent", () => {
  const children: PlanBridgeChild[] = [
    { id: "c1", itemId: "manual-1", parentSharePercent: 10 },
    { id: "c2", itemId: "forecast-1", parentSharePercent: 40 },
    { id: "c3", itemId: "forecast-2", parentSharePercent: 50 },
  ];

  it("sums share for children not in selection", () => {
    expect(
      computeManualSharePercent(children, new Set(["forecast-1", "forecast-2"]))
    ).toBe(10);
  });

  it("returns 0 when all children are selected", () => {
    expect(
      computeManualSharePercent(
        children,
        new Set(["manual-1", "forecast-1", "forecast-2"])
      )
    ).toBe(0);
  });
});

describe("suggestItemAction", () => {
  it("returns CREATE when no existing target", () => {
    expect(suggestItemAction(100, null, PLAN_TOLERANCE_PERCENT)).toBe("CREATE");
  });

  it("returns UPDATE when existing target is zero", () => {
    expect(suggestItemAction(100, 0, PLAN_TOLERANCE_PERCENT)).toBe("UPDATE");
  });

  it("returns SKIP within tolerance", () => {
    expect(suggestItemAction(105, 100, PLAN_TOLERANCE_PERCENT)).toBe("SKIP");
  });

  it("returns UPDATE outside tolerance", () => {
    expect(suggestItemAction(110, 100, PLAN_TOLERANCE_PERCENT)).toBe("UPDATE");
  });
});

describe("buildCategoryApplyPlan", () => {
  const selectedItems: SelectedApplyItem[] = [
    {
      itemId: "f1",
      parentSku: "SKU-A",
      adjustedQty: 100,
      action: "CREATE",
      code: "SKU-A",
      name: "Product A",
    },
    {
      itemId: "f2",
      parentSku: "SKU-B",
      adjustedQty: 200,
      action: "CREATE",
      code: "SKU-B",
      name: "Product B",
    },
  ];

  it("builds parent total and proportional child shares after manual children", () => {
    const existingChildren: PlanBridgeChild[] = [
      { id: "m1", itemId: "manual-1", parentSharePercent: 10 },
    ];

    const plan = buildCategoryApplyPlan({
      itemCategoryId: "cat-1",
      selectedItems,
      existingRoot: null,
      existingChildren,
    });

    expect(plan.skipped).toBe(false);
    expect(plan.parentTargetQty).toBe(300);
    expect(plan.parentAction).toBe("CREATE");
    expect(plan.childUpserts).toHaveLength(2);
    const shares = plan.childUpserts.map((c) => c.parentSharePercent);
    expect(shares).toEqual([30, 60]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(90);
  });

  it("gives single forecast item full remaining pool", () => {
    const single: SelectedApplyItem[] = [
      {
        itemId: "f1",
        parentSku: "SKU-A",
        adjustedQty: 50,
        action: "UPDATE",
        code: "SKU-A",
        name: "Product A",
      },
    ];

    const plan = buildCategoryApplyPlan({
      itemCategoryId: "cat-1",
      selectedItems: single,
      existingRoot: { id: "root-1", targetQty: 40 },
      existingChildren: [
        { id: "c1", itemId: "f1", parentSharePercent: 80 },
        { id: "m1", itemId: "manual-1", parentSharePercent: 20 },
      ],
    });

    expect(plan.skipped).toBe(false);
    expect(plan.parentAction).toBe("UPDATE");
    expect(plan.existingParentId).toBe("root-1");
    expect(plan.childUpserts[0]?.parentSharePercent).toBe(80);
    expect(plan.childUpserts[0]?.action).toBe("UPDATE");
  });

  it("skips category when manual share is 100%", () => {
    const plan = buildCategoryApplyPlan({
      itemCategoryId: "cat-full",
      selectedItems,
      existingRoot: { id: "root-1", targetQty: 100 },
      existingChildren: [
        { id: "m1", itemId: "manual-1", parentSharePercent: 100 },
      ],
    });

    expect(plan.skipped).toBe(true);
    expect(plan.error).toMatch(/manual/i);
  });

  it("skips category when total qty is zero", () => {
    const plan = buildCategoryApplyPlan({
      itemCategoryId: "cat-zero",
      selectedItems: [
        {
          itemId: "f1",
          parentSku: "SKU-A",
          adjustedQty: 0,
          action: "UPDATE",
          code: "SKU-A",
          name: "Product A",
        },
      ],
      existingRoot: null,
      existingChildren: [],
    });

    expect(plan.skipped).toBe(true);
    expect(plan.error).toMatch(/zero/i);
  });

  it("detects UPDATE vs CREATE for existing children", () => {
    const plan = buildCategoryApplyPlan({
      itemCategoryId: "cat-1",
      selectedItems: [
        {
          itemId: "f1",
          parentSku: "SKU-A",
          adjustedQty: 100,
          action: "UPDATE",
          code: "SKU-A",
          name: "Product A",
        },
      ],
      existingRoot: { id: "root-1", targetQty: 80 },
      existingChildren: [{ id: "child-1", itemId: "f1", parentSharePercent: 50 }],
    });

    expect(plan.childUpserts[0]?.action).toBe("UPDATE");
    expect(plan.childUpserts[0]?.existingChildId).toBe("child-1");
  });
});
