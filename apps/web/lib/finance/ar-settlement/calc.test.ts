import { describe, expect, it } from "vitest";
import { computeSettlementTotals, computeVariance } from "./calc";

describe("computeSettlementTotals", () => {
  it("nets retur and program off the invoice total before the admin fee", () => {
    const t = computeSettlementTotals([1000000], [
      { type: "RETUR_OFFSET", amount: 200000 },
      { type: "PROGRAM", amount: 100000 },
      { type: "ADMIN_FEE", percent: 10 },
    ]);
    expect(t.adminFeeBase).toBe(700000);
    expect(t.adminFee).toBe(70000);
    expect(t.expected).toBe(630000);
  });

  it("sums several retur offsets and several program deductions", () => {
    const t = computeSettlementTotals([500000, 500000], [
      { type: "RETUR_OFFSET", amount: 100000 },
      { type: "RETUR_OFFSET", amount: 50000 },
      { type: "PROGRAM", amount: 25000 },
      { type: "PROGRAM", amount: 25000 },
    ]);
    expect(t.returTotal).toBe(150000);
    expect(t.programTotal).toBe(50000);
    expect(t.adminFeeBase).toBe(800000);
    expect(t.adminFee).toBe(0);
    expect(t.expected).toBe(800000);
  });

  it("charges the admin fee on the netted base, not the gross invoice", () => {
    const gross = computeSettlementTotals([1000000], [{ type: "ADMIN_FEE", percent: 10 }]);
    const netted = computeSettlementTotals([1000000], [
      { type: "RETUR_OFFSET", amount: 500000 },
      { type: "ADMIN_FEE", percent: 10 },
    ]);
    expect(gross.adminFee).toBe(100000);
    expect(netted.adminFee).toBe(50000);
  });

  it("rounds the admin fee to whole cents", () => {
    const t = computeSettlementTotals([333333], [{ type: "ADMIN_FEE", percent: 3 }]);
    expect(t.adminFee).toBe(9999.99);
  });

  it("treats a missing admin fee as zero rather than NaN", () => {
    /**
     * An `ADMIN_FEE` deduction with no `percent` field at all — not an empty deductions array,
     * which never reaches the `?? 0` fallback since `.filter(...).reduce(...)` on an empty result
     * short-circuits to the reduce's own seed regardless of any fallback in its callback.
     */
    const t = computeSettlementTotals([1000], [{ type: "ADMIN_FEE" }]);
    expect(t.adminFee).toBe(0);
    expect(t.expected).toBe(1000);
  });
});

describe("computeVariance", () => {
  it("returns a negative variance when the store pays less than expected", () => {
    expect(computeVariance(630000, 600000)).toBe(-30000);
  });

  it("returns a positive variance when the store overpays", () => {
    expect(computeVariance(630000, 650000)).toBe(20000);
  });
});
