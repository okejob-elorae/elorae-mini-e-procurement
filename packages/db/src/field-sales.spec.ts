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

  it("falls back to parentSku for variantSku/erpVariantSku when a line has no variant (empty variantSku)", () => {
    const rows = buildOfflineSalesHistoryRows({
      orderNo: "PUTUS-20260704-0002",
      orderTotal: 35000,
      lines: [
        { itemId: "i1", variantSku: "", parentSku: "FG-A", productName: "Item A", qty: 2, unitPrice: 10000, lineTotal: 20000, productCategory: "Cat" },
        { itemId: "i2", variantSku: "", parentSku: "FG-B", productName: "Item B", qty: 3, unitPrice: 5000, lineTotal: 15000, productCategory: "Cat" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].variantSku).toBe("FG-A");
    expect(rows[0].erpVariantSku).toBe("FG-A");
    expect(rows[0].parentSku).toBe("FG-A");
    expect(rows[1].variantSku).toBe("FG-B");
    expect(rows[1].erpVariantSku).toBe("FG-B");
    expect(rows[1].parentSku).toBe("FG-B");
  });

  it("aggregates two lines that resolve to the same variantSku into a single summed row", () => {
    const rows = buildOfflineSalesHistoryRows({
      orderNo: "PUTUS-20260704-0003",
      orderTotal: 175000,
      lines: [
        { itemId: "i1", variantSku: "FG-RED-M", parentSku: "FG", productName: "Kaos Merah", qty: 2, unitPrice: 35000, lineTotal: 70000, productCategory: "Kaos" },
        { itemId: "i1", variantSku: "FG-RED-M", parentSku: "FG", productName: "Kaos Merah", qty: 3, unitPrice: 35000, lineTotal: 105000, productCategory: "Kaos" },
      ],
    });
    expect(rows).toEqual([
      {
        channel: "OFFLINE",
        orderId: "PUTUS-20260704-0003",
        orderStatus: "COMPLETED",
        variantSku: "FG-RED-M",
        parentSku: "FG",
        productName: "Kaos Merah",
        quantity: 5,
        returnedQuantity: 0,
        netQuantity: 5,
        unitPrice: 35000,
        unitPriceAfterDiscount: 35000,
        lineTotal: 175000,
        orderTotal: 175000,
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
