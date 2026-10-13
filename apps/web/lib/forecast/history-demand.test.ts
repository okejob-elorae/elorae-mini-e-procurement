import { describe, expect, it } from "vitest";
import { salesHistoryToDemandRows, type SalesHistoryDemandRecord } from "./history-demand";

function rec(overrides: Partial<SalesHistoryDemandRecord> = {}): SalesHistoryDemandRecord {
  return {
    parentSku: "240000-G82",
    productName: "Daisy Polo Crop Shirt",
    netQuantity: 1,
    lineTotal: 100_000,
    orderDate: new Date(Date.UTC(2026, 5, 10, 5)),
    itemId: "item-1",
    mapped: true,
    ...overrides,
  };
}

describe("salesHistoryToDemandRows", () => {
  it("keeps each WIB month separate for one item instead of folding its whole history into one month", () => {
    const rows = salesHistoryToDemandRows([
      rec({ orderDate: new Date(Date.UTC(2026, 5, 10, 5)), netQuantity: 2 }),
      rec({ orderDate: new Date(Date.UTC(2026, 5, 20, 5)), netQuantity: 3 }),
      rec({ orderDate: new Date(Date.UTC(2026, 6, 2, 5)), netQuantity: 4 }),
    ]);
    expect(rows.map((r) => [r.year, r.month, r.netQuantity])).toEqual([
      [2026, 6, 5],
      [2026, 7, 4],
    ]);
  });

  it("buckets by the Jakarta calendar", () => {
    // 30 Jun 18:00 UTC is 1 Jul 01:00 WIB.
    const rows = salesHistoryToDemandRows([rec({ orderDate: new Date(Date.UTC(2026, 5, 30, 18)) })]);
    expect(rows[0]).toMatchObject({ year: 2026, month: 7 });
  });

  it("groups a mapped row by item and an unmapped row by its own parent SKU", () => {
    const rows = salesHistoryToDemandRows([
      rec({ parentSku: "SKU-A", itemId: "item-1" }),
      rec({ parentSku: "SKU-B", itemId: "item-1" }),
      rec({ parentSku: "RAW-X", itemId: null, mapped: false }),
    ]);
    expect(rows.map((r) => [r.parentSku, r.netQuantity, r.itemId])).toEqual([
      ["SKU-A", 2, "item-1"],
      ["RAW-X", 1, null],
    ]);
  });
});
