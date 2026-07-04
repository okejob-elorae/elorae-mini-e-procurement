export function effectiveMinQty(itemMinOrderQty: number | null, globalMin: number): number {
  return itemMinOrderQty ?? globalMin;
}

export function validateMinQtyLines(
  lines: Array<{ itemId: string; qty: number }>,
  minByItemId: Map<string, number>,
): { itemId: string; requiredMin: number; actualQty: number } | null {
  for (const line of lines) {
    const requiredMin = minByItemId.get(line.itemId) ?? 0;
    if (line.qty < requiredMin) {
      return { itemId: line.itemId, requiredMin, actualQty: line.qty };
    }
  }
  return null;
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
  return input.lines.map((l) => ({
    channel: "OFFLINE",
    orderId: input.orderNo,
    orderStatus: "COMPLETED",
    variantSku: l.variantSku,
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
    erpVariantSku: l.variantSku,
    jubelioItemId: null,
    resolutionStatus: "MAPPED",
    importBatchId: null,
    productCategory: l.productCategory,
  }));
}
