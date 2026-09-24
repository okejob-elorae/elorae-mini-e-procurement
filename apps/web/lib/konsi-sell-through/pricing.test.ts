import { describe, it, expect } from "vitest";
import { priceSellThroughLines } from "./pricing";

describe("priceSellThroughLines", () => {
  it("grosses each line up by the store margin and sums the rounded line totals", () => {
    const r = priceSellThroughLines({
      marginPercent: 20,
      lines: [
        { key: "a::", billedQty: 3, sellingPrice: 40000 },
        { key: "b::", billedQty: 1.2, sellingPrice: 10003 },
      ],
    });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: 50000, lineTotal: 150000 });
    /* 10003 / 0.8 = 12503.75; × 1.2 = 15004.5 (values chosen off the half-cent boundary) */
    expect(r.lines[1]).toEqual({ key: "b::", unitPrice: 12503.75, lineTotal: 15004.5 });
    expect(r.total).toBe(165004.5);
    expect(r.unpricedKeys).toEqual([]);
  });

  it("marks a billed line with no selling price unpriced and prices it at 0", () => {
    const r = priceSellThroughLines({ marginPercent: 20, lines: [{ key: "a::", billedQty: 2, sellingPrice: null }] });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: null, lineTotal: 0 });
    expect(r.unpricedKeys).toEqual(["a::"]);
  });

  it("marks every billed line unpriced when the store margin is unset or out of range, instead of billing the raw selling price", () => {
    for (const marginPercent of [null, 100, -5]) {
      const r = priceSellThroughLines({ marginPercent, lines: [{ key: "a::", billedQty: 1, sellingPrice: 40000 }] });
      expect(r.lines[0].unitPrice).toBeNull();
      expect(r.unpricedKeys).toEqual(["a::"]);
    }
  });

  it("never flags a line billing 0, priced or not", () => {
    const r = priceSellThroughLines({
      marginPercent: null,
      lines: [
        { key: "a::", billedQty: 0, sellingPrice: 40000 },
        { key: "b::", billedQty: 0, sellingPrice: null },
      ],
    });
    expect(r.unpricedKeys).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("keeps a unit price on a zero-billed line that prices, for display", () => {
    const r = priceSellThroughLines({ marginPercent: 20, lines: [{ key: "a::", billedQty: 0, sellingPrice: 40000 }] });
    expect(r.lines[0]).toEqual({ key: "a::", unitPrice: 50000, lineTotal: 0 });
  });
});
