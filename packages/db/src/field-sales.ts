export function effectiveMinQty(itemMinOrderQty: number | null, globalMin: number): number {
  return itemMinOrderQty ?? globalMin;
}

export function validateMinQtyLines(
  lines: Array<{ itemId: string; qty: number }>,
  minByItemId: Map<string, number>,
): Array<{ itemId: string; requiredMin: number; actualQty: number }> {
  const violations: Array<{ itemId: string; requiredMin: number; actualQty: number }> = [];
  for (const line of lines) {
    const requiredMin = minByItemId.get(line.itemId) ?? 0;
    if (line.qty < requiredMin) violations.push({ itemId: line.itemId, requiredMin, actualQty: line.qty });
  }
  return violations;
}

export type OfflineSalesHistoryRow = {
  channel: "OFFLINE";
  orderId: string;
  orderStatus: "COMPLETED";
  variantSku: string;
  parentSku: string;
  productName: string;
  quantity: number;
  returnedQuantity: number;
  netQuantity: number;
  unitPrice: number;
  unitPriceAfterDiscount: number;
  lineTotal: number;
  orderTotal: number;
  itemId: string;
  erpVariantSku: string;
  jubelioItemId: null;
  resolutionStatus: "MAPPED";
  importBatchId: null;
  productCategory: string | null;
};

export function buildOfflineSalesHistoryRows(input: {
  orderNo: string;
  orderTotal: number;
  lines: Array<{
    itemId: string;
    variantSku: string;
    parentSku: string;
    productName: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    productCategory: string | null;
  }>;
}): OfflineSalesHistoryRow[] {
  const rowsByVariantSku = new Map<string, OfflineSalesHistoryRow>();
  const orderedKeys: string[] = [];

  for (const l of input.lines) {
    const resolvedVariantSku = l.variantSku || l.parentSku;
    const existing = rowsByVariantSku.get(resolvedVariantSku);
    if (existing) {
      existing.quantity += l.qty;
      existing.netQuantity += l.qty;
      existing.lineTotal += l.lineTotal;
      continue;
    }
    rowsByVariantSku.set(resolvedVariantSku, {
      channel: "OFFLINE",
      orderId: input.orderNo,
      orderStatus: "COMPLETED",
      variantSku: resolvedVariantSku,
      parentSku: l.parentSku,
      productName: l.productName,
      quantity: l.qty,
      returnedQuantity: 0,
      netQuantity: l.qty,
      unitPrice: l.unitPrice,
      unitPriceAfterDiscount: l.unitPrice,
      lineTotal: l.lineTotal,
      orderTotal: input.orderTotal,
      itemId: l.itemId,
      erpVariantSku: resolvedVariantSku,
      jubelioItemId: null,
      resolutionStatus: "MAPPED",
      importBatchId: null,
      productCategory: l.productCategory,
    });
    orderedKeys.push(resolvedVariantSku);
  }

  return orderedKeys.map((key) => rowsByVariantSku.get(key)!);
}
