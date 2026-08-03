export type CartLine = {
  itemId: string;
  variantSku: string;
  variantLabel: string | null;
  sku: string;
  nameId: string;
  unitPrice: number;
  available: number;
  qty: number;
  // Putus only — the salesman never sets unitPrice; this is the appealed ask for a store-rule
  // override, decided by the office at approve. null = no appeal, use the store price.
  requestedUnitPrice: number | null;
  appealReason: string | null;
};

export type OrderLineInput = {
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  unitPrice: number;
  requestedUnitPrice?: number | null;
  appealReason?: string | null;
};

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

export function buildOrderLines(lines: CartLine[]): OrderLineInput[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    variantSku: l.variantSku,
    productName: l.variantLabel ? `${l.nameId} — ${l.variantLabel}` : l.nameId,
    qty: l.qty,
    unitPrice: l.unitPrice,
    requestedUnitPrice: l.requestedUnitPrice ?? null,
    appealReason: l.appealReason ?? null,
  }));
}
