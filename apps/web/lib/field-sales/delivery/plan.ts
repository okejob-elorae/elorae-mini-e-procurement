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

/**
 * Invoice date plus a store's payment tempo, in whole days.
 *
 * This is a SUGGESTION, never an authority. The client locked that a nota's due date is
 * entered by a human and must not be silently set from `Store.paymentTempo`, so the writer
 * does not call this — the delivery dialog does, behind a button the operator presses. Keep
 * it pure so it can run in the browser.
 */
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
 *
 * `lines` must carry EVERY line of the order, not only the ones in this delivery. A line that
 * finished in an earlier delivery can still hold rounding residue — three 1-unit deliveries of a
 * 3-unit line discounted 100 allocate round(100/3) = 33 each and strand 1 — and the closing
 * delivery is the last place that residue can go. Lines with `deliveredQty` 0 get no line discount
 * of their own; on the closing delivery their residue folds into the header `discountAmount`
 * instead, which is what keeps the sum of delivery totals equal to the order total.
 */
export function allocateDeliveryDiscounts(input: DiscountAllocationInput): DiscountAllocation {
  const lineDiscounts = input.lines
    .filter((l) => l.deliveredQty > 0)
    .map((l) => {
      const remaining = Math.max(0, l.lineDiscount - l.lineDiscountAllocated);
      if (input.closesOrder) return { orderLineId: l.orderLineId, discountAmount: remaining };
      const share = l.orderedQty > 0 ? Math.round((l.lineDiscount * l.deliveredQty) / l.orderedQty) : 0;
      return { orderLineId: l.orderLineId, discountAmount: Math.min(share, remaining) };
    });

  /**
   * Residue on lines this delivery does not carry. Only the closing delivery can absorb it, and a
   * cancelled line can never appear here: closing the remainder cancels every still-open line at
   * once, so an order with any cancelled qty has no outstanding qty left to deliver.
   */
  const strandedLineRemainder = input.closesOrder
    ? input.lines
        .filter((l) => l.deliveredQty <= 0)
        .reduce((sum, l) => sum + Math.max(0, l.lineDiscount - l.lineDiscountAllocated), 0)
    : 0;

  const orderRemaining = Math.max(0, input.orderDiscount - input.orderDiscountAllocated);
  let orderDiscountAmount: number;
  if (input.closesOrder) {
    orderDiscountAmount = orderRemaining + strandedLineRemainder;
  } else {
    const deliveredSubtotal = input.lines.reduce((s, l) => s + l.deliveredSubtotal, 0);
    const share =
      input.orderSubtotal > 0 ? Math.round((input.orderDiscount * deliveredSubtotal) / input.orderSubtotal) : 0;
    orderDiscountAmount = Math.min(share, orderRemaining);
  }

  return { lineDiscounts, orderDiscountAmount };
}
