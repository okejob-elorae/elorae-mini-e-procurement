import { describe, expect, it } from "vitest";
import { computeSettlementTotals, computeVariance, EPSILON } from "./calc";

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

/**
 * One assertion, and it is not a tautology. `EPSILON` is imported by four modules that must agree
 * on it exactly — the two writers, the approval preview's query layer and its pure check builders
 * — and nothing type-checks two independently declared constants against each other. Pinning the
 * value here is what makes a "tidy-up" that re-declares it next to a consumer, or nudges the
 * magnitude, a failing test rather than a silent fork between what the screen offers and what the
 * writer accepts. `submit-writer.ts` carried its own private copy at this value until it was
 * folded into this module.
 */
describe("EPSILON", () => {
  it("is the one shared float-comparison slack, at 1e-6", () => {
    expect(EPSILON).toBe(1e-6);
  });
});
