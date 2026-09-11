import { describe, it, expect } from "vitest";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  outstandingQty,
  deliverableQty,
  nextDeliveryStatus,
  computeDueDate,
  allocateDeliveryDiscounts,
} from "./plan";

describe("outstandingQty", () => {
  it("nets delivered and cancelled off the ordered qty", () => {
    expect(outstandingQty({ orderLineId: "a", qty: 10, deliveredQty: 3, cancelledQty: 2 })).toBe(5);
  });

  it("never returns a negative", () => {
    expect(outstandingQty({ orderLineId: "a", qty: 5, deliveredQty: 5, cancelledQty: 3 })).toBe(0);
  });
});

describe("deliverableQty", () => {
  it("caps outstanding at on-hand", () => {
    expect(deliverableQty(10, 4)).toBe(4);
  });

  it("returns outstanding when stock is plentiful", () => {
    expect(deliverableQty(10, 40)).toBe(10);
  });

  it("floors at zero when on-hand is already negative", () => {
    expect(deliverableQty(10, -3)).toBe(0);
  });
});

describe("nextDeliveryStatus", () => {
  it("is PENDING when nothing has moved", () => {
    expect(nextDeliveryStatus([{ orderLineId: "a", qty: 10, deliveredQty: 0, cancelledQty: 0 }])).toBe("PENDING");
  });

  it("is PARTIAL when some but not all is delivered", () => {
    expect(nextDeliveryStatus([{ orderLineId: "a", qty: 10, deliveredQty: 4, cancelledQty: 0 }])).toBe("PARTIAL");
  });

  it("is PARTIAL when one line is complete and another is not", () => {
    expect(
      nextDeliveryStatus([
        { orderLineId: "a", qty: 10, deliveredQty: 10, cancelledQty: 0 },
        { orderLineId: "b", qty: 4, deliveredQty: 0, cancelledQty: 0 },
      ]),
    ).toBe("PARTIAL");
  });

  it("is DELIVERED when every line is fully delivered and nothing was cancelled", () => {
    expect(nextDeliveryStatus([{ orderLineId: "a", qty: 10, deliveredQty: 10, cancelledQty: 0 }])).toBe("DELIVERED");
  });

  it("is CLOSED when outstanding is zero and some of it was cancelled", () => {
    expect(nextDeliveryStatus([{ orderLineId: "a", qty: 10, deliveredQty: 6, cancelledQty: 4 }])).toBe("CLOSED");
  });

  it("is CLOSED when everything was cancelled without a single delivery", () => {
    expect(nextDeliveryStatus([{ orderLineId: "a", qty: 10, deliveredQty: 0, cancelledQty: 10 }])).toBe("CLOSED");
  });
});

describe("computeDueDate", () => {
  it("adds the tempo in days", () => {
    expect(computeDueDate(new Date("2026-08-09T00:00:00.000Z"), 30).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });

  it("returns the invoice date itself when tempo is zero", () => {
    expect(computeDueDate(new Date("2026-08-09T00:00:00.000Z"), 0).toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  /**
   * The only production caller is the "Pakai tempo" button, which feeds a WIB-midnight instant —
   * an instant that sits at 17:00 UTC on the PREVIOUS UTC day. `setUTCDate` therefore walks the
   * UTC day while the operator is reading a WIB calendar, so these cases assert the property that
   * actually matters: the WIB calendar day advances by exactly the tempo, and stays at WIB
   * midnight. The UTC-midnight cases above cannot see that, because there the two calendars agree.
   */
  const WIB_MONTH_END = new Date("2026-08-31T00:00:00.000+07:00");

  it("advances the WIB calendar day across a month boundary", () => {
    const due = computeDueDate(WIB_MONTH_END, 1);
    expect(formatDateOnlyJakarta(due)).toBe("2026-09-01");
    expect(due.toISOString()).toBe("2026-08-31T17:00:00.000Z");
  });

  it("advances a WIB-midnight invoice date by a full 30-day tempo", () => {
    const due = computeDueDate(WIB_MONTH_END, 30);
    expect(formatDateOnlyJakarta(due)).toBe("2026-09-30");
    expect(due.toISOString()).toBe("2026-09-29T17:00:00.000Z");
  });

  it("leaves a WIB-midnight invoice date on its own calendar day when the tempo is zero", () => {
    const due = computeDueDate(WIB_MONTH_END, 0);
    expect(formatDateOnlyJakarta(due)).toBe("2026-08-31");
    expect(due.toISOString()).toBe("2026-08-30T17:00:00.000Z");
  });
});

describe("allocateDeliveryDiscounts", () => {
  it("takes a rounded pro-rata share on a non-closing delivery", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: false,
      orderSubtotal: 300,
      orderDiscount: 100,
      orderDiscountAllocated: 0,
      lines: [{ orderLineId: "a", lineDiscount: 30, orderedQty: 3, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 100 }],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 10 }]);
    expect(got.orderDiscountAmount).toBe(33);
  });

  it("gives the closing delivery the whole unallocated remainder", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: true,
      orderSubtotal: 300,
      orderDiscount: 100,
      orderDiscountAllocated: 66,
      lines: [{ orderLineId: "a", lineDiscount: 30, orderedQty: 3, deliveredQty: 1, lineDiscountAllocated: 20, deliveredSubtotal: 100 }],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 10 }]);
    expect(got.orderDiscountAmount).toBe(34);
  });

  it("never allocates more than the unallocated remainder", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: false,
      orderSubtotal: 100,
      orderDiscount: 50,
      orderDiscountAllocated: 48,
      lines: [{ orderLineId: "a", lineDiscount: 10, orderedQty: 2, deliveredQty: 2, lineDiscountAllocated: 9, deliveredSubtotal: 100 }],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 1 }]);
    expect(got.orderDiscountAmount).toBe(2);
  });

  it("allocates nothing when the order carries no discount", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: true,
      orderSubtotal: 100,
      orderDiscount: 0,
      orderDiscountAllocated: 0,
      lines: [{ orderLineId: "a", lineDiscount: 0, orderedQty: 2, deliveredQty: 2, lineDiscountAllocated: 0, deliveredSubtotal: 100 }],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 0 }]);
    expect(got.orderDiscountAmount).toBe(0);
  });

  it("is safe when the order subtotal is zero", () => {
    /*
     * `orderedQty: 0` with `deliveredQty: 1` is deliberately inconsistent data — it is the only
     * shape that reaches the line-side divide-by-zero guard, since a line delivering nothing is
     * filtered out before the division. A regression there puts NaN into a Decimal money column.
     */
    const got = allocateDeliveryDiscounts({
      closesOrder: false,
      orderSubtotal: 0,
      orderDiscount: 0,
      orderDiscountAllocated: 0,
      lines: [{ orderLineId: "a", lineDiscount: 0, orderedQty: 0, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 0 }],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 0 }]);
    expect(got.orderDiscountAmount).toBe(0);
  });

  it("gives no line discount to a line this delivery does not carry", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: false,
      orderSubtotal: 400,
      orderDiscount: 0,
      orderDiscountAllocated: 0,
      lines: [
        { orderLineId: "a", lineDiscount: 100, orderedQty: 3, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 100 },
        { orderLineId: "b", lineDiscount: 0, orderedQty: 1, deliveredQty: 0, lineDiscountAllocated: 0, deliveredSubtotal: 0 },
      ],
    });
    expect(got.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 33 }]);
  });

  it("folds residue stranded on a line that finished earlier into the closing delivery's header discount", () => {
    /*
     * Line A: qty 3, discount 100, shipped one unit at a time. Line B: qty 1, no discount, shipped
     * last. Each of A's three deliveries takes round(100/3) = 33, so A is fully delivered with 99
     * of its 100 allocated — and A is absent from the delivery that closes the order. Without the
     * fold, that last rupiah is stranded and the deliveries sum to one more than the order total.
     */
    const lineA = { orderLineId: "a", lineDiscount: 100, orderedQty: 3 };
    const lineB = { orderLineId: "b", lineDiscount: 0, orderedQty: 1 };
    const base = { orderSubtotal: 400, orderDiscount: 0, orderDiscountAllocated: 0 };

    const first = allocateDeliveryDiscounts({
      ...base,
      closesOrder: false,
      lines: [
        { ...lineA, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 100 },
        { ...lineB, deliveredQty: 0, lineDiscountAllocated: 0, deliveredSubtotal: 0 },
      ],
    });
    expect(first.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 33 }]);

    const second = allocateDeliveryDiscounts({
      ...base,
      closesOrder: false,
      lines: [
        { ...lineA, deliveredQty: 1, lineDiscountAllocated: 33, deliveredSubtotal: 100 },
        { ...lineB, deliveredQty: 0, lineDiscountAllocated: 0, deliveredSubtotal: 0 },
      ],
    });
    expect(second.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 33 }]);

    const third = allocateDeliveryDiscounts({
      ...base,
      closesOrder: false,
      lines: [
        { ...lineA, deliveredQty: 1, lineDiscountAllocated: 66, deliveredSubtotal: 100 },
        { ...lineB, deliveredQty: 0, lineDiscountAllocated: 0, deliveredSubtotal: 0 },
      ],
    });
    expect(third.lineDiscounts).toEqual([{ orderLineId: "a", discountAmount: 33 }]);

    /* A is fully delivered and absent here; only B ships, and this delivery closes the order. */
    const closing = allocateDeliveryDiscounts({
      ...base,
      closesOrder: true,
      lines: [
        { ...lineA, deliveredQty: 0, lineDiscountAllocated: 99, deliveredSubtotal: 0 },
        { ...lineB, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 100 },
      ],
    });
    expect(closing.lineDiscounts).toEqual([{ orderLineId: "b", discountAmount: 0 }]);
    expect(closing.orderDiscountAmount).toBe(1);

    const allocatedToLines = [first, second, third, closing]
      .flatMap((a) => a.lineDiscounts)
      .reduce((sum, l) => sum + l.discountAmount, 0);
    const allocatedToHeaders = [first, second, third, closing].reduce((sum, a) => sum + a.orderDiscountAmount, 0);
    expect(allocatedToLines + allocatedToHeaders).toBe(100);
  });

  it("adds the stranded line residue to the order discount remainder rather than replacing it", () => {
    const got = allocateDeliveryDiscounts({
      closesOrder: true,
      orderSubtotal: 400,
      orderDiscount: 50,
      orderDiscountAllocated: 20,
      lines: [
        { orderLineId: "a", lineDiscount: 100, orderedQty: 3, deliveredQty: 0, lineDiscountAllocated: 99, deliveredSubtotal: 0 },
        { orderLineId: "b", lineDiscount: 0, orderedQty: 1, deliveredQty: 1, lineDiscountAllocated: 0, deliveredSubtotal: 100 },
      ],
    });
    expect(got.orderDiscountAmount).toBe(31); /* 30 order remainder + 1 stranded on line a */
  });
});
