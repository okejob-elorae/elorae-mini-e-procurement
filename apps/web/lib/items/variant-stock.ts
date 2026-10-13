export type VariantStock = { onHand: number; available: number };

export type VariantStockRowInput = {
  variantSku: string;
  qtyOnHand: unknown;
  reservedQty: unknown;
};

const toNumber = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Reshapes variant rows into a `variantSku` keyed record of plain numbers. `available` is derived
 * as `onHand - reserved` and kept negative when over-reserved, so a caller can flag it. A key that
 * repeats is summed, never overwritten.
 */
export function toVariantStockRecord(rows: VariantStockRowInput[]): Record<string, VariantStock> {
  const out: Record<string, VariantStock> = {};
  for (const r of rows) {
    const onHand = toNumber(r.qtyOnHand);
    const available = onHand - toNumber(r.reservedQty);
    const prev = out[r.variantSku];
    out[r.variantSku] = prev
      ? { onHand: prev.onHand + onHand, available: prev.available + available }
      : { onHand, available };
  }
  return out;
}
