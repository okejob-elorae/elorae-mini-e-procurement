import { describe, it, expect } from "vitest";
import { planSmartRequest, type PlanCandidate, type PlanHistory } from "./plan";

const ratio = [
  { size: "S", qty: 1 },
  { size: "M", qty: 2 },
];
const fullVariants = (id: string) => [
  { variantSku: `${id}-S`, size: "S" },
  { variantSku: `${id}-M`, size: "M" },
];
const fullStock = (id: string) => ({ [`${id}-S`]: 9, [`${id}-M`]: 9 });
const cand = (itemId: string, sku: string): PlanCandidate => ({
  itemId,
  sku,
  variants: fullVariants(itemId),
  available: fullStock(itemId),
});
const emptyHistory: PlanHistory = { neverOrdered: new Set(), qtyByItem: new Map() };

describe("planSmartRequest", () => {
  it("expands one pack per article up to the pack budget", () => {
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 2, candidates: [cand("a", "A"), cand("b", "B"), cand("c", "C")] }],
      { neverOrdered: new Set(["a", "b", "c"]), qtyByItem: new Map() },
      ratio,
    );
    // 2 packs placed (A, B by sku tiebreak), each 2 lines (S=1, M=2)
    expect(plan.lines.filter((l) => l.itemId === "a")).toEqual([
      { itemId: "a", variantSku: "a-S", size: "S", qty: 1 },
      { itemId: "a", variantSku: "a-M", size: "M", qty: 2 },
    ]);
    expect(new Set(plan.lines.map((l) => l.itemId))).toEqual(new Set(["a", "b"]));
    expect(plan.underfill).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  it("ranks never-ordered before already-ordered", () => {
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 1, candidates: [cand("old", "A"), cand("new", "Z")] }],
      { neverOrdered: new Set(["new"]), qtyByItem: new Map([["old", 100]]) },
      ratio,
    );
    expect(plan.lines.every((l) => l.itemId === "new")).toBe(true);
  });

  it("ranks already-ordered by all-time qty desc, then sku asc", () => {
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 1, candidates: [cand("lo", "A"), cand("hi", "Z")] }],
      { neverOrdered: new Set(), qtyByItem: new Map([["lo", 5], ["hi", 50]]) },
      ratio,
    );
    expect(plan.lines.every((l) => l.itemId === "hi")).toBe(true);
  });

  it("drops an article short on stock and continues to the next", () => {
    const shortA: PlanCandidate = { itemId: "a", sku: "A", variants: fullVariants("a"), available: { "a-S": 1, "a-M": 1 } };
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 1, candidates: [shortA, cand("b", "B")] }],
      { neverOrdered: new Set(["a", "b"]), qtyByItem: new Map() },
      ratio,
    );
    expect(plan.dropped).toEqual([
      { categoryId: "c1", itemId: "a", sku: "A", reason: "INSUFFICIENT_STOCK", detail: "M: butuh 2, ada 1" },
    ]);
    expect(new Set(plan.lines.map((l) => l.itemId))).toEqual(new Set(["b"]));
  });

  it("drops an article missing a ratio size", () => {
    const noM: PlanCandidate = { itemId: "a", sku: "A", variants: [{ variantSku: "a-S", size: "S" }], available: { "a-S": 9 } };
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 1, candidates: [noM] }],
      { neverOrdered: new Set(["a"]), qtyByItem: new Map() },
      ratio,
    );
    expect(plan.dropped).toEqual([{ categoryId: "c1", itemId: "a", sku: "A", reason: "MISSING_SIZE", detail: "M" }]);
    expect(plan.underfill).toEqual([{ categoryId: "c1", requestedPacks: 1, placedPacks: 0 }]);
  });

  it("reports under-fill when fewer packs placed than requested", () => {
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 5, candidates: [cand("a", "A"), cand("b", "B")] }],
      { neverOrdered: new Set(["a", "b"]), qtyByItem: new Map() },
      ratio,
    );
    expect(plan.underfill).toEqual([{ categoryId: "c1", requestedPacks: 5, placedPacks: 2 }]);
  });

  it("drops every article when the ratio is empty (EMPTY_RATIO)", () => {
    const plan = planSmartRequest(
      [{ categoryId: "c1", packs: 1, candidates: [cand("a", "A")] }],
      { neverOrdered: new Set(["a"]), qtyByItem: new Map() },
      [],
    );
    expect(plan.lines).toEqual([]);
    expect(plan.dropped).toEqual([{ categoryId: "c1", itemId: "a", sku: "A", reason: "EMPTY_RATIO" }]);
  });

  it("handles multiple categories independently", () => {
    const plan = planSmartRequest(
      [
        { categoryId: "c1", packs: 1, candidates: [cand("a", "A")] },
        { categoryId: "c2", packs: 1, candidates: [cand("b", "B")] },
      ],
      emptyHistory,
      ratio,
    );
    expect(new Set(plan.lines.map((l) => l.itemId))).toEqual(new Set(["a", "b"]));
  });
});
