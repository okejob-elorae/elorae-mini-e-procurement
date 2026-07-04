export type CartLine = {
  itemId: string;
  variantSku: string;
  sku: string;
  nameId: string;
  unitPrice: number;
  available: number;
  qty: number;
};

export type OrderLineInput = {
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  unitPrice: number;
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
    productName: l.nameId,
    qty: l.qty,
    unitPrice: l.unitPrice,
  }));
}
