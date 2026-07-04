import { describe, it, expect } from "vitest";
import { effectiveMinQty, validateMinQtyLines, buildOfflineSalesHistoryRows } from "./field-sales";

describe("effectiveMinQty", () => {
  it("per-item override wins when set", () => {
    expect(effectiveMinQty(12, 6)).toBe(12);
  });
  it("falls back to global when item override is null", () => {
    expect(effectiveMinQty(null, 6)).toBe(6);
  });
  it("treats 0 override as a real value, not falsy fallback", () => {
    expect(effectiveMinQty(0, 6)).toBe(0);
  });
});

describe("validateMinQtyLines", () => {
  const mins = new Map([["a", 6], ["b", 10]]);
  it("returns null when all lines meet their minimum", () => {
    expect(validateMinQtyLines([{ itemId: "a", qty: 6 }, { itemId: "b", qty: 10 }], mins)).toBeNull();
  });
  it("returns the first violation", () => {
    expect(validateMinQtyLines([{ itemId: "a", qty: 6 }, { itemId: "b", qty: 4 }], mins))
      .toEqual({ itemId: "b", requiredMin: 10, actualQty: 4 });
  });
  it("uses 0 min when itemId absent from the map (no minimum)", () => {
    expect(validateMinQtyLines([{ itemId: "z", qty: 1 }], mins)).toBeNull();
  });
});

describe("buildOfflineSalesHistoryRows", () => {
  it("maps an approved order to OFFLINE/COMPLETED history rows", () => {
    const rows = buildOfflineSalesHistoryRows({
      orderNo: "PUTUS-20260704-0001",
      orderTotal: 210000,
      lines: [
        { itemId: "i1", variantSku: "FG-RED-M", parentSku: "FG", productName: "Kaos", qty: 6, unitPrice: 35000, lineTotal: 210000, productCategory: "Kaos" },
      ],
    });
    expect(rows).toEqual([
      {
        channel: "OFFLINE",
        orderId: "PUTUS-20260704-0001",
        orderStatus: "COMPLETED",
        variantSku: "FG-RED-M",
        parentSku: "FG",
        productName: "Kaos",
        quantity: 6,
        returnedQuantity: 0,
        netQuantity: 6,
        unitPrice: 35000,
        unitPriceAfterDiscount: 35000,
        lineTotal: 210000,
        orderTotal: 210000,
        itemId: "i1",
        erpVariantSku: "FG-RED-M",
        jubelioItemId: null,
        resolutionStatus: "MAPPED",
        importBatchId: null,
        productCategory: "Kaos",
      },
    ]);
  });
});
