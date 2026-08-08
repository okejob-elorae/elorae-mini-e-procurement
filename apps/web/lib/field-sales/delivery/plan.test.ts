import { describe, it, expect } from "vitest";
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
    const got = allocateDeliveryDiscounts({
      closesOrder: false,
      orderSubtotal: 0,
      orderDiscount: 0,
      orderDiscountAllocated: 0,
      lines: [{ orderLineId: "a", lineDiscount: 0, orderedQty: 0, deliveredQty: 0, lineDiscountAllocated: 0, deliveredSubtotal: 0 }],
    });
    expect(got.orderDiscountAmount).toBe(0);
  });
});
