/**
 * Pure, import-free (client-safe) derivation of per-line returned quantities
 * from raw `SalesReturnItem` rows. Kept free of any import so a client
 * component can pull it in without dragging the `@elorae/db` barrel along.
 */

export type ReturnSummaryItem = {
  salesOrderDetailId: number | null;
  qty: string;
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
};

export type ReturnSummaryInput = {
  items: ReturnSummaryItem[];
};

export type LineReturnSummary = {
  returnedQty: number;
  acceptedReturnQty: number;
  rejectedReturnQty: number;
};

export type ReturnsSummary = {
  byLine: Map<number, LineReturnSummary>;
  unmatchedQty: number;
};

const ZERO_LINE_SUMMARY: LineReturnSummary = {
  returnedQty: 0,
  acceptedReturnQty: 0,
  rejectedReturnQty: 0,
};

/**
 * Sums every return item's qty onto its matching sales-order line, split by
 * decision. An item with no `salesOrderDetailId` cannot be attributed to any
 * line — its qty is folded into `unmatchedQty` instead of being dropped, so a
 * count mismatch between the returns and the lines is never silent.
 */
export function summarizeReturns(returns: ReturnSummaryInput[]): ReturnsSummary {
  const byLine = new Map<number, LineReturnSummary>();
  let unmatchedQty = 0;

  for (const ret of returns) {
    for (const item of ret.items) {
      const qty = Number(item.qty);
      if (item.salesOrderDetailId === null) {
        unmatchedQty += qty;
        continue;
      }
      const existing = byLine.get(item.salesOrderDetailId) ?? { ...ZERO_LINE_SUMMARY };
      existing.returnedQty += qty;
      if (item.decision === "ACCEPTED") existing.acceptedReturnQty += qty;
      if (item.decision === "REJECTED") existing.rejectedReturnQty += qty;
      byLine.set(item.salesOrderDetailId, existing);
    }
  }

  return { byLine, unmatchedQty };
}

/** Looks up one line's summary, defaulting to all-zero when it has no returns. */
export function lineReturnSummaryOf(
  summary: ReturnsSummary,
  salesOrderDetailId: number,
): LineReturnSummary {
  return summary.byLine.get(salesOrderDetailId) ?? ZERO_LINE_SUMMARY;
}
