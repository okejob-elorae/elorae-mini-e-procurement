export type DeliveryStatusValue = "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";

/**
 * orderLineId is optional so a raw Prisma FieldSalesOrderLine (which names it `id`) can be
 * passed straight in. Only the three quantities matter to this module.
 */
export type OrderLineState = {
  orderLineId?: string;
  qty: number;
  deliveredQty: number;
  cancelledQty: number;
};

export type DiscountAllocationLine = {
  orderLineId: string;
  lineDiscount: number;
  orderedQty: number;
  deliveredQty: number;
  lineDiscountAllocated: number;
  deliveredSubtotal: number;
};

export type DiscountAllocationInput = {
  closesOrder: boolean;
  orderSubtotal: number;
  orderDiscount: number;
  orderDiscountAllocated: number;
  lines: DiscountAllocationLine[];
};

export type DiscountAllocation = {
  lineDiscounts: Array<{ orderLineId: string; discountAmount: number }>;
  orderDiscountAmount: number;
};

/** Ordered qty still awaiting a delivery decision. Floors at 0 so bad data cannot go negative. */
export function outstandingQty(line: OrderLineState): number {
  return Math.max(0, line.qty - line.deliveredQty - line.cancelledQty);
}

/**
 * Deliverable is capped at on-hand, NOT at available. This order's own reservation is already
 * inside reservedQty, so netting it again would double-count and under-deliver.
 */
export function deliverableQty(outstanding: number, onHand: number): number {
  return Math.max(0, Math.min(outstanding, Math.floor(onHand)));
}

export function nextDeliveryStatus(lines: OrderLineState[]): DeliveryStatusValue {
  const anyDelivered = lines.some((l) => l.deliveredQty > 0);
  const anyCancelled = lines.some((l) => l.cancelledQty > 0);
  const allSettled = lines.every((l) => outstandingQty(l) === 0);
  if (!allSettled) return anyDelivered || anyCancelled ? "PARTIAL" : "PENDING";
  if (anyCancelled) return "CLOSED";
  return anyDelivered ? "DELIVERED" : "PENDING";
}

export function computeDueDate(invoiceDate: Date, paymentTempoDays: number): Date {
  const due = new Date(invoiceDate.getTime());
  due.setUTCDate(due.getUTCDate() + Math.max(0, Math.floor(paymentTempoDays)));
  return due;
}

/**
 * Allocates line and order discounts to one delivery. A non-closing delivery takes its rounded
 * pro-rata share, capped at what is still unallocated. The delivery that drives the order's
 * outstanding qty to zero takes the entire remainder, so the deliveries sum back to the order
 * exactly and no rounding residue escapes.
 */
export function allocateDeliveryDiscounts(input: DiscountAllocationInput): DiscountAllocation {
  const lineDiscounts = input.lines.map((l) => {
    const remaining = Math.max(0, l.lineDiscount - l.lineDiscountAllocated);
    if (input.closesOrder) return { orderLineId: l.orderLineId, discountAmount: remaining };
    const share = l.orderedQty > 0 ? Math.round((l.lineDiscount * l.deliveredQty) / l.orderedQty) : 0;
    return { orderLineId: l.orderLineId, discountAmount: Math.min(share, remaining) };
  });

  const orderRemaining = Math.max(0, input.orderDiscount - input.orderDiscountAllocated);
  let orderDiscountAmount: number;
  if (input.closesOrder) {
    orderDiscountAmount = orderRemaining;
  } else {
    const deliveredSubtotal = input.lines.reduce((s, l) => s + l.deliveredSubtotal, 0);
    const share =
      input.orderSubtotal > 0 ? Math.round((input.orderDiscount * deliveredSubtotal) / input.orderSubtotal) : 0;
    orderDiscountAmount = Math.min(share, orderRemaining);
  }

  return { lineDiscounts, orderDiscountAmount };
}
