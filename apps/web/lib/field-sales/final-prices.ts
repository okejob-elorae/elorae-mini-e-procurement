export type InvalidFinalPriceCode =
  | "UNKNOWN_LINE"
  | "NOT_APPEALED"
  | "DUPLICATE_LINE"
  | "MISSING_FINAL_PRICE"
  | "BAD_PRICE";

export type FinalPriceCheck = { ok: true } | { ok: false; code: InvalidFinalPriceCode; lineId: string | null };

/* The largest value `FieldSalesOrderLine.unitPrice` and `lineTotal` hold — both are DECIMAL(15,2). */
export const MAX_LINE_AMOUNT = 9_999_999_999_999.99;

/**
 * A PUTUS approval must carry exactly one final price per appealed line (requestedUnitPrice set)
 * and nothing else. Per entry the order is DUPLICATE, UNKNOWN, NOT_APPEALED, BAD_PRICE; an
 * appealed line left without an entry is MISSING_FINAL_PRICE. BAD_PRICE also covers a price, or
 * a price times the line's `qty`, past `MAX_LINE_AMOUNT`, which the column would refuse at write.
 */
export function checkFinalPrices(
  lines: Array<{ id: string; requestedUnitPrice: unknown | null; qty: number }>,
  finalPrices: Array<{ lineId: string; finalUnitPrice: number }> | undefined,
): FinalPriceCheck {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const f of finalPrices ?? []) {
    if (seen.has(f.lineId)) return { ok: false, code: "DUPLICATE_LINE", lineId: f.lineId };
    seen.add(f.lineId);
    const line = byId.get(f.lineId);
    if (!line) return { ok: false, code: "UNKNOWN_LINE", lineId: f.lineId };
    if (line.requestedUnitPrice === null) return { ok: false, code: "NOT_APPEALED", lineId: f.lineId };
    if (
      !Number.isFinite(f.finalUnitPrice) ||
      f.finalUnitPrice < 0 ||
      f.finalUnitPrice > MAX_LINE_AMOUNT ||
      f.finalUnitPrice * line.qty > MAX_LINE_AMOUNT
    ) {
      return { ok: false, code: "BAD_PRICE", lineId: f.lineId };
    }
  }
  for (const l of lines) {
    if (l.requestedUnitPrice !== null && !seen.has(l.id)) {
      return { ok: false, code: "MISSING_FINAL_PRICE", lineId: l.id };
    }
  }
  return { ok: true };
}
