import { describe, expect, it } from "vitest";
import { lineReturnSummaryOf, summarizeReturns, type ReturnSummaryInput } from "./returns-summary";

describe("summarizeReturns", () => {
  it("returns all zeros when there are no returns", () => {
    const summary = summarizeReturns([]);
    expect(summary.unmatchedQty).toBe(0);
    expect(summary.byLine.size).toBe(0);
    expect(lineReturnSummaryOf(summary, 1)).toEqual({
      returnedQty: 0,
      acceptedReturnQty: 0,
      rejectedReturnQty: 0,
    });
  });

  it("sums two returns that both touch the same line", () => {
    const returns: ReturnSummaryInput[] = [
      { items: [{ salesOrderDetailId: 10, qty: "2", decision: "PENDING" }] },
      { items: [{ salesOrderDetailId: 10, qty: "3", decision: "PENDING" }] },
    ];
    const summary = summarizeReturns(returns);
    expect(lineReturnSummaryOf(summary, 10).returnedQty).toBe(5);
  });

  it("folds items with a null salesOrderDetailId into unmatchedQty instead of dropping them", () => {
    const returns: ReturnSummaryInput[] = [
      {
        items: [
          { salesOrderDetailId: null, qty: "4", decision: "PENDING" },
          { salesOrderDetailId: 1, qty: "1", decision: "PENDING" },
        ],
      },
    ];
    const summary = summarizeReturns(returns);
    expect(summary.unmatchedQty).toBe(4);
    expect(lineReturnSummaryOf(summary, 1).returnedQty).toBe(1);
    /* The unmatched item must not be attributable to any real line. */
    expect(summary.byLine.has(1)).toBe(true);
  });

  it("splits accepted vs rejected quantities per line, leaving pending out of both", () => {
    const returns: ReturnSummaryInput[] = [
      {
        items: [
          { salesOrderDetailId: 7, qty: "2", decision: "ACCEPTED" },
          { salesOrderDetailId: 7, qty: "1", decision: "REJECTED" },
          { salesOrderDetailId: 7, qty: "5", decision: "PENDING" },
        ],
      },
    ];
    const summary = summarizeReturns(returns);
    const line = lineReturnSummaryOf(summary, 7);
    expect(line.returnedQty).toBe(8);
    expect(line.acceptedReturnQty).toBe(2);
    expect(line.rejectedReturnQty).toBe(1);
  });
});
