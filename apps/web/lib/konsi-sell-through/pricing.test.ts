import { describe, it, expect } from "vitest";
import { priceSellThroughLines } from "./pricing";

describe("priceSellThroughLines", () => {
  it("bills each line at the catalog selling price and sums the rounded line totals", () => {
    const r = priceSellThroughLines({
      lines: [
        { key: "a::", billedQty: 3, sellingPrice: 40000 },
        { key: "b::", billedQty: 1.2, sellingPrice: 10003.33 },
      ],
    });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: 40000, lineTotal: 120000 });
    /* 1.2 × 10003.33 = 12003.996, rounded to 12004 (values chosen off the half-cent boundary) */
    expect(r.lines[1]).toEqual({ key: "b::", unitPrice: 10003.33, lineTotal: 12004 });
    expect(r.total).toBe(132004);
    expect(r.unpricedKeys).toEqual([]);
  });

  it("marks a billed line with no selling price unpriced and prices it at 0", () => {
    const r = priceSellThroughLines({ lines: [{ key: "a::", billedQty: 2, sellingPrice: null }] });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: null, lineTotal: 0 });
    expect(r.unpricedKeys).toEqual(["a::"]);
  });

  it("marks a billed line whose selling price is not a finite number unpriced", () => {
    const r = priceSellThroughLines({ lines: [{ key: "a::", billedQty: 1, sellingPrice: Number.NaN }] });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: null, lineTotal: 0 });
    expect(r.unpricedKeys).toEqual(["a::"]);
  });

  it("never flags a line billing 0, priced or not", () => {
    const r = priceSellThroughLines({
      lines: [
        { key: "a::", billedQty: 0, sellingPrice: 40000 },
        { key: "b::", billedQty: 0, sellingPrice: null },
      ],
    });
    expect(r.unpricedKeys).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("keeps a unit price on a zero-billed line that prices, for display", () => {
    const r = priceSellThroughLines({ lines: [{ key: "a::", billedQty: 0, sellingPrice: 40000 }] });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: 40000, lineTotal: 0 });
  });

  it("ignores a store markup a stale caller still passes", () => {
    /* vitest does not type-check, so a caller still sending the old markup input reaches here; it must not move the invoice */
    const stale = { marginPercent: 20, markupPercent: 20, lines: [{ key: "a::", billedQty: 4, sellingPrice: 40000 }] };
    const r = priceSellThroughLines(stale as unknown as Parameters<typeof priceSellThroughLines>[0]);
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: 40000, lineTotal: 160000 });
    expect(r.total).toBe(160000);
  });
});
