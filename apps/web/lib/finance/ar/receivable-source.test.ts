import { describe, expect, it } from "vitest";
import {
  ReceivableSourceMissingError,
  resolveReceivableSource,
  resolveTaxInvoiceSource,
  type ReceivableSourceRow,
  type TaxInvoiceSourceRow,
} from "./receivable-source";

describe("resolveReceivableSource", () => {
  it("maps every DELIVERY field", () => {
    const row: ReceivableSourceRow = {
      delivery: {
        id: "delivery-1",
        docNo: "DLV/0001",
        deliveredAt: new Date("2026-09-01T00:00:00Z"),
        order: {
          id: "order-1",
          orderNo: "FSO/0001",
          salesmanId: "salesman-1",
          salesman: { name: "Budi" },
        },
      },
      sellThrough: null,
    };

    expect(resolveReceivableSource(row)).toEqual({
      kind: "DELIVERY",
      deliveryId: "delivery-1",
      docNo: "DLV/0001",
      orderId: "order-1",
      orderNo: "FSO/0001",
      salesmanId: "salesman-1",
      salesmanName: "Budi",
      deliveredAt: new Date("2026-09-01T00:00:00Z"),
    });
  });

  it("falls back to null salesmanName when the DELIVERY order's salesman has no name", () => {
    const row: ReceivableSourceRow = {
      delivery: {
        id: "delivery-1",
        docNo: "DLV/0001",
        deliveredAt: new Date("2026-09-01T00:00:00Z"),
        order: {
          id: "order-1",
          orderNo: "FSO/0001",
          salesmanId: "salesman-1",
          salesman: { name: null },
        },
      },
      sellThrough: null,
    };

    expect(resolveReceivableSource(row).salesmanName).toBeNull();
  });

  it("maps every SELL_THROUGH field", () => {
    const row: ReceivableSourceRow = {
      delivery: null,
      sellThrough: {
        id: "sellthrough-1",
        docNo: "KST/0001",
        periodStart: new Date("2026-08-01T00:00:00Z"),
        periodEnd: new Date("2026-08-31T00:00:00Z"),
        salesmanId: "salesman-2",
        salesman: { name: "Ani" },
      },
    };

    expect(resolveReceivableSource(row)).toEqual({
      kind: "SELL_THROUGH",
      sellThroughId: "sellthrough-1",
      docNo: "KST/0001",
      salesmanId: "salesman-2",
      salesmanName: "Ani",
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-31T00:00:00Z"),
    });
  });

  it("maps a SELL_THROUGH row with no salesman assigned to null salesmanId and salesmanName", () => {
    const row: ReceivableSourceRow = {
      delivery: null,
      sellThrough: {
        id: "sellthrough-1",
        docNo: "KST/0001",
        periodStart: null,
        periodEnd: new Date("2026-08-31T00:00:00Z"),
        salesmanId: null,
        salesman: null,
      },
    };

    expect(resolveReceivableSource(row)).toEqual({
      kind: "SELL_THROUGH",
      sellThroughId: "sellthrough-1",
      docNo: "KST/0001",
      salesmanId: null,
      salesmanName: null,
      periodStart: null,
      periodEnd: new Date("2026-08-31T00:00:00Z"),
    });
  });

  it("prefers delivery when both relations are somehow set", () => {
    const row: ReceivableSourceRow = {
      delivery: {
        id: "delivery-1",
        docNo: "DLV/0001",
        deliveredAt: new Date("2026-09-01T00:00:00Z"),
        order: {
          id: "order-1",
          orderNo: "FSO/0001",
          salesmanId: "salesman-1",
          salesman: { name: "Budi" },
        },
      },
      sellThrough: {
        id: "sellthrough-1",
        docNo: "KST/0001",
        periodStart: null,
        periodEnd: new Date("2026-08-31T00:00:00Z"),
        salesmanId: "salesman-2",
        salesman: { name: "Ani" },
      },
    };

    expect(resolveReceivableSource(row).kind).toBe("DELIVERY");
  });

  it("throws ReceivableSourceMissingError when neither relation is set", () => {
    const row: ReceivableSourceRow = { delivery: null, sellThrough: null };
    expect(() => resolveReceivableSource(row)).toThrow(ReceivableSourceMissingError);
  });
});

describe("resolveTaxInvoiceSource", () => {
  it("maps every DELIVERY field", () => {
    const row: TaxInvoiceSourceRow = {
      delivery: {
        docNo: "DLV/0001",
        invoiceDate: new Date("2026-09-01T00:00:00Z"),
        dueDate: new Date("2026-09-15T00:00:00Z"),
        total: 150000,
        orderId: "order-1",
        order: { store: { id: "store-1", name: "Toko Maju", npwp: "12.345" } },
      },
      sellThrough: null,
    };

    expect(resolveTaxInvoiceSource(row)).toEqual({
      kind: "DELIVERY",
      docNo: "DLV/0001",
      orderId: "order-1",
      storeId: "store-1",
      storeName: "Toko Maju",
      storeNpwp: "12.345",
      invoiceDate: new Date("2026-09-01T00:00:00Z"),
      dueDate: new Date("2026-09-15T00:00:00Z"),
      total: 150000,
    });
  });

  it("converts a Decimal-shaped total to a plain number", () => {
    const decimalLike = { toString: () => "150000", valueOf: () => "150000" };
    const row: TaxInvoiceSourceRow = {
      delivery: {
        docNo: "DLV/0001",
        invoiceDate: new Date("2026-09-01T00:00:00Z"),
        dueDate: new Date("2026-09-15T00:00:00Z"),
        total: decimalLike as unknown as number,
        orderId: "order-1",
        order: { store: { id: "store-1", name: "Toko Maju", npwp: null } },
      },
      sellThrough: null,
    };

    expect(resolveTaxInvoiceSource(row).total).toBe(150000);
  });

  it("maps every SELL_THROUGH field, with invoiceDate/dueDate/total null", () => {
    const row: TaxInvoiceSourceRow = {
      delivery: null,
      sellThrough: {
        id: "sellthrough-1",
        docNo: "KST/0001",
        storeId: "store-2",
        store: { id: "store-2", name: "Toko Sejahtera", npwp: null },
        periodEnd: new Date("2026-08-31T00:00:00Z"),
      },
    };

    expect(resolveTaxInvoiceSource(row)).toEqual({
      kind: "SELL_THROUGH",
      docNo: "KST/0001",
      sellThroughId: "sellthrough-1",
      storeId: "store-2",
      storeName: "Toko Sejahtera",
      storeNpwp: null,
      invoiceDate: null,
      dueDate: null,
      total: null,
      periodEnd: new Date("2026-08-31T00:00:00Z"),
    });
  });

  it("throws ReceivableSourceMissingError when neither relation is set", () => {
    const row: TaxInvoiceSourceRow = { delivery: null, sellThrough: null };
    expect(() => resolveTaxInvoiceSource(row)).toThrow(ReceivableSourceMissingError);
  });
});
