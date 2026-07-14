import { describe, expect, it } from "vitest";
import {
  deriveStockStatus,
  filterAndSortStockItems,
  filterByStockStatus,
  sortStockItems,
  summarizeStockHealth,
} from "./stock-status";

describe("deriveStockStatus", () => {
  it("returns NEGATIF when available is negative", () => {
    expect(deriveStockStatus(-1, 10)).toBe("NEGATIF");
    expect(deriveStockStatus(-5, null)).toBe("NEGATIF");
  });

  it("returns HABIS when available is exactly zero", () => {
    expect(deriveStockStatus(0, 10)).toBe("HABIS");
    expect(deriveStockStatus(0, null)).toBe("HABIS");
  });

  it("returns MENIPIS when available is above zero and at or below reorder point", () => {
    expect(deriveStockStatus(5, 10)).toBe("MENIPIS");
    expect(deriveStockStatus(10, 10)).toBe("MENIPIS");
  });

  it("returns OK when above reorder point or no reorder point", () => {
    expect(deriveStockStatus(11, 10)).toBe("OK");
    expect(deriveStockStatus(100, null)).toBe("OK");
  });

  it("prioritizes Negatif over Menipis when both could apply", () => {
    expect(deriveStockStatus(-1, 100)).toBe("NEGATIF");
  });
});

describe("summarizeStockHealth", () => {
  it("sums available and counts each status bucket", () => {
    const summary = summarizeStockHealth([
      { available: 50, reorderPoint: 10 },
      { available: 5, reorderPoint: 10 },
      { available: 0, reorderPoint: 10 },
      { available: -2, reorderPoint: null },
      { available: 20, reorderPoint: null },
    ]);

    expect(summary).toEqual({
      totalAvailable: 73,
      menipisCount: 1,
      habisCount: 1,
      negatifCount: 1,
      okCount: 2,
    });
  });

  it("returns zeros for empty list", () => {
    expect(summarizeStockHealth([])).toEqual({
      totalAvailable: 0,
      menipisCount: 0,
      habisCount: 0,
      negatifCount: 0,
      okCount: 0,
    });
  });
});

describe("filterByStockStatus", () => {
  const items = [
    { available: -1, reorderPoint: null, sku: "A" },
    { available: 0, reorderPoint: null, sku: "B" },
    { available: 3, reorderPoint: 5, sku: "C" },
    { available: 20, reorderPoint: 5, sku: "D" },
  ];

  it("returns all when status is undefined", () => {
    expect(filterByStockStatus(items, undefined)).toHaveLength(4);
  });

  it("filters by status", () => {
    expect(filterByStockStatus(items, "NEGATIF").map((i) => i.sku)).toEqual(["A"]);
    expect(filterByStockStatus(items, "HABIS").map((i) => i.sku)).toEqual(["B"]);
    expect(filterByStockStatus(items, "MENIPIS").map((i) => i.sku)).toEqual(["C"]);
    expect(filterByStockStatus(items, "OK").map((i) => i.sku)).toEqual(["D"]);
  });
});

describe("sortStockItems", () => {
  const items = [
    { itemId: "1", sku: "B-02", available: 10, reorderPoint: null },
    { itemId: "2", sku: "A-01", available: 30, reorderPoint: null },
    { itemId: "3", sku: "C-03", available: 10, reorderPoint: null },
  ];

  it("sorts by stock descending with sku tiebreak", () => {
    expect(sortStockItems(items, "stock_desc").map((i) => i.sku)).toEqual([
      "A-01",
      "B-02",
      "C-03",
    ]);
  });

  it("sorts by stock ascending with sku tiebreak", () => {
    expect(sortStockItems(items, "stock_asc").map((i) => i.sku)).toEqual([
      "B-02",
      "C-03",
      "A-01",
    ]);
  });

  it("sorts by sku", () => {
    expect(sortStockItems(items, "sku").map((i) => i.sku)).toEqual([
      "A-01",
      "B-02",
      "C-03",
    ]);
  });

  it("defaults to stock_desc", () => {
    expect(sortStockItems(items).map((i) => i.sku)).toEqual(["A-01", "B-02", "C-03"]);
  });
});

describe("filterAndSortStockItems", () => {
  it("filters then sorts", () => {
    const items = [
      { itemId: "1", sku: "Z", available: 2, reorderPoint: 5 },
      { itemId: "2", sku: "A", available: 4, reorderPoint: 5 },
      { itemId: "3", sku: "M", available: 100, reorderPoint: null },
    ];
    expect(
      filterAndSortStockItems(items, { status: "MENIPIS", sort: "stock_asc" }).map(
        (i) => i.sku,
      ),
    ).toEqual(["Z", "A"]);
  });
});
