import { Test } from "@nestjs/testing";
import { SalesOrderWebhookHandler } from "./salesorder.handler";
import { SalesReturnIngestService } from "../returns/sales-return-ingest.service";
import { PRISMA } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import * as db from "@elorae/db";

jest.mock("@elorae/db", () => ({
  ...jest.requireActual("@elorae/db"),
  applyJubelioStockAdjustment: jest.fn(),
}));

const applyMock = (db as any).applyJubelioStockAdjustment as jest.Mock;

function row(payload: any, overrides: any = {}) {
  return {
    id: "wh_1",
    event: "salesorder",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
    ...overrides,
  };
}

function makePayload(overrides: any = {}) {
  return {
    action: "update-salesorder",
    salesorder_id: 23043,
    salesorder_no: "SO-23043",
    channel_status: "READY_TO_SHIP",
    internal_status: "PROCESSING",
    is_canceled: false,
    items: [
      { item_id: 1721, item_code: "SKU-A", item_group_id: 96, qty: "1.0000", salesorder_detail_id: 25193, is_canceled_item: null },
      { item_id: 1688, item_code: "SKU-B", item_group_id: 96, qty: "2.0000", salesorder_detail_id: 25194, is_canceled_item: null },
    ],
    ...overrides,
  };
}

describe("SalesOrderWebhookHandler", () => {
  let handler: SalesOrderWebhookHandler;
  let prisma: any;
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    applyMock.mockReset();
    prisma = {
      jubelioSalesOrderState: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      jubelioProductMapping: {
        findFirst: jest.fn(),
      },
      inventoryValue: {
        findUnique: jest.fn(),
      },
      salesOrder: {
        upsert: jest.fn().mockResolvedValue({ id: "so1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      salesOrderItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    admin = { write: jest.fn() };
    const salesReturnIngest = { upsertFromApiDetail: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        SalesOrderWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: AdminNotificationService, useValue: admin },
        { provide: SalesReturnIngestService, useValue: salesReturnIngest },
      ],
    }).compile();
    handler = mod.get(SalesOrderWebhookHandler);
  });

  it("SKIPs missing_salesorder_id when payload lacks salesorder_id", async () => {
    const r = await handler.handle(row({ items: [] }) as any);
    expect(r).toEqual({ kind: "skipped", reason: "missing_salesorder_id" });
  });

  it("first webhook active state, all lines mapped -> decrements + state created", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false, lastStatus: null, lastIsCanceled: false,
      appliedAt: null, reversedAt: null, lastWebhookEventId: "wh_1",
    });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) return Promise.resolve({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
      if (where.jubelioItemId === 1688) return Promise.resolve({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique
      .mockResolvedValueOnce({ qtyOnHand: 10 })
      .mockResolvedValueOnce({ qtyOnHand: 5 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      itemId: "i_a",
      variantSku: "SKU-A",
      idempotencyKey: "salesorder-23043-decrement-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: true, lastIsCanceled: false }),
    }));
    expect(admin.write).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("first webhook with is_canceled=true -> no decrement, state created with stockApplied=false", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false,
    });

    const r = await handler.handle(row(makePayload({ is_canceled: true })) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastIsCanceled: true }),
    }));
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.status).toBe("CANCELLED");
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.isCanceled).toBe(true);
    expect(r).toEqual({ kind: "processed" });
  });

  it("second webhook still active -> no transition (state.stockApplied already true)", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("cancellation after decrement -> reversal applied, state.stockApplied=false", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) return Promise.resolve({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
      if (where.jubelioItemId === 1688) return Promise.resolve({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique
      .mockResolvedValueOnce({ qtyOnHand: 9 })
      .mockResolvedValueOnce({ qtyOnHand: 3 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload({ is_canceled: true })) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      idempotencyKey: "salesorder-23043-reversal-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: false, reversedAt: expect.any(Date) }),
    }));
    expect(r).toEqual({ kind: "processed" });
  });

  it("un-cancel after reversal -> re-decrement, state.stockApplied=true again", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false,
    });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) return Promise.resolve({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
      if (where.jubelioItemId === 1688) return Promise.resolve({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique
      .mockResolvedValueOnce({ qtyOnHand: 10 })
      .mockResolvedValueOnce({ qtyOnHand: 5 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      idempotencyKey: "salesorder-23043-decrement-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: true }),
    }));
    expect(r).toEqual({ kind: "processed" });
  });

  it("unmapped item_id -> AdminNotification fired, mapped lines still processed", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) return Promise.resolve({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique.mockResolvedValueOnce({ qtyOnHand: 10 });
    applyMock.mockResolvedValue({});

    await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(admin.write).toHaveBeenCalledTimes(1);
    expect(admin.write).toHaveBeenCalledWith(expect.objectContaining({
      category: "JUBELIO_UNMAPPED_LINES",
      metadata: expect.objectContaining({
        salesorderId: 23043,
        lines: expect.arrayContaining([expect.objectContaining({ item_code: "SKU-B", item_id: 1688 })]),
      }),
    }));
  });

  it("line with is_canceled_item=true is skipped, other lines processed", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) return Promise.resolve({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique.mockResolvedValueOnce({ qtyOnHand: 10 });
    applyMock.mockResolvedValue({});
    const payload = makePayload();
    payload.items[1].is_canceled_item = true;

    await handler.handle(row(payload) as any);

    expect(applyMock).toHaveBeenCalledTimes(1);
    // Note: findFirst is called 3 times — once per line in upsertSalesOrder (2x), plus once for the mapped line in applyAdjustments.
    expect(prisma.jubelioProductMapping.findFirst).toHaveBeenCalledTimes(3);
  });

  it("all lines unmapped -> one AdminNotification, no stock writes, state still updates", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    await handler.handle(row(makePayload()) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(admin.write).toHaveBeenCalledTimes(1);
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalled();
  });

  it("upserts SalesOrder + SalesOrderItem on first webhook (happy path)", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockImplementation(({ where }: any) => {
      if (where.jubelioItemId === 1721) {
        return Promise.resolve({ id: "m1", itemId: "i1", erpVariantSku: "SKU-A", jubelioItemId: 1721, jubelioItemGroupId: 96, jubelioItemCode: "SKU-A" });
      }
      return Promise.resolve(null);
    });
    prisma.inventoryValue.findUnique.mockResolvedValueOnce({ qtyOnHand: 10 });
    applyMock.mockResolvedValue({});

    const payload = makePayload({
      source_name: "Shop | Tokopedia",
      customer_name: "Alice",
      shipping_province: "Jakarta",
      shipping_city: "Jakarta Selatan",
      sub_total: "100000",
      total_disc: "5000",
      total_tax: "0",
      grand_total: "97000",
      shipping_cost: "2000",
      transaction_date: "2026-06-11T10:00:00.000Z",
      items: [
        { salesorder_detail_id: 25193, item_id: 1721, item_code: "SKU-A", item_group_id: 96, item_name: "Item A", qty: "1.0000", qty_in_base: "1.0000", is_canceled_item: null, sell_price: "100000", price: "97000", disc_amount: "3000", tax_amount: "0", amount: "97000" },
        { salesorder_detail_id: 25194, item_id: 1688, item_code: "SKU-B", item_group_id: 96, item_name: "Item B", qty: "2.0000", qty_in_base: "2.0000", is_canceled_item: null, sell_price: "50000", price: "50000", disc_amount: "0", tax_amount: "0", amount: "100000" },
      ],
    });

    const r = await handler.handle(row(payload) as any);

    expect(r).toEqual({ kind: "processed" });
    expect(prisma.salesOrder.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.salesOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ salesorderId: 23043 });
    expect(upsertArgs.create.channel).toBe("TOKOPEDIA");
    expect(upsertArgs.create.sourceName).toBe("Shop | Tokopedia");
    expect(upsertArgs.create.customerName).toBe("Alice");
    expect(upsertArgs.create.shippingProvince).toBe("Jakarta");
    expect(upsertArgs.create.grandTotal).toBe("97000");
    expect(upsertArgs.create.transactionDate).toEqual(new Date("2026-06-11T10:00:00.000Z"));
    expect(upsertArgs.create.lastWebhookEventId).toBe("wh_1");

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany).toHaveBeenCalledTimes(1);
    const createArgs = prisma.salesOrderItem.createMany.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data[0]).toMatchObject({
      salesOrderId: "so1",
      salesorderDetailId: 25193,
      jubelioItemId: 1721,
      jubelioItemCode: "SKU-A",
      itemId: "i1",
      productName: "Item A",
      qty: "1.0000",
      unitPrice: "100000",
      pricePaid: "97000",
      lineTotal: "97000",
    });
    expect(createArgs.data[1].itemId).toBeNull();
    expect(createArgs.data[1].jubelioItemCode).toBe("SKU-B");
  });

  it("upsert is idempotent — re-receiving same payload calls upsert once per webhook with same key", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    const r1 = row(makePayload()) as any;
    const r2 = row(makePayload()) as any;
    await handler.handle(r1);
    await handler.handle(r2);

    expect(prisma.salesOrder.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.salesOrder.upsert.mock.calls[0][0].where).toEqual({ salesorderId: 23043 });
    expect(prisma.salesOrder.upsert.mock.calls[1][0].where).toEqual({ salesorderId: 23043 });
  });

  it("replaces SalesOrderItem set on re-receive (delete-then-createMany)", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    const firstPayload = makePayload({
      items: [
        { salesorder_detail_id: 1, item_id: 10, item_code: "A", item_group_id: 1, qty: "1", is_canceled_item: null },
        { salesorder_detail_id: 2, item_id: 11, item_code: "B", item_group_id: 1, qty: "1", is_canceled_item: null },
      ],
    });
    await handler.handle(row(firstPayload) as any);

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany.mock.calls[0][0].data).toHaveLength(2);

    prisma.salesOrderItem.createMany.mockClear();
    prisma.salesOrderItem.deleteMany.mockClear();

    const secondPayload = makePayload({
      items: [
        { salesorder_detail_id: 1, item_id: 10, item_code: "A", item_group_id: 1, qty: "1", is_canceled_item: null },
      ],
    });
    await handler.handle(row(secondPayload) as any);

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("logs WARN and persists OTHER channel for unknown source_name", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);
    const warn = jest.spyOn((handler as any).logger, "warn").mockImplementation(() => {});

    await handler.handle(row(makePayload({ source_name: "Shop | Lazada" })) as any);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Lazada"));
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.channel).toBe("OTHER");
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.sourceName).toBe("Shop | Lazada");
    warn.mockRestore();
  });

  it("falls back to created_date when transaction_date missing", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    await handler.handle(row(makePayload({
      transaction_date: null,
      created_date: "2026-06-11T08:00:00.000Z",
    })) as any);

    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.transactionDate)
      .toEqual(new Date("2026-06-11T08:00:00.000Z"));
  });

  it("falls back to now() with WARN when both transaction_date and created_date missing", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);
    const warn = jest.spyOn((handler as any).logger, "warn").mockImplementation(() => {});
    const before = Date.now();

    await handler.handle(row(makePayload({ transaction_date: null, created_date: null })) as any);

    const txDate = prisma.salesOrder.upsert.mock.calls[0][0].create.transactionDate as Date;
    expect(txDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("missing transaction_date"));
    warn.mockRestore();
  });

  it("rolls back the whole transaction if salesOrderItem.createMany throws", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: true });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);
    prisma.salesOrderItem.createMany.mockRejectedValueOnce(new Error("createMany boom"));

    await expect(handler.handle(row(makePayload()) as any)).rejects.toThrow("createMany boom");

    expect(prisma.jubelioSalesOrderState.update).not.toHaveBeenCalled();
  });

  it("auto-advances fulfillmentStatus to SHIPPED when Jubelio reports shipped", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    await handler.handle(row(makePayload({
      wms_status: "SHIPPED",
      completed_date: "2026-06-14T10:00:00.000Z",
    })) as any);

    // upsert path seeds fulfillmentStatus=SHIPPED on CREATE
    const upsertArgs = prisma.salesOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.create.fulfillmentStatus).toBe("SHIPPED");
    expect(upsertArgs.create.shippedAt).toEqual(new Date("2026-06-14T10:00:00.000Z"));
    // base UPDATE payload does NOT carry the patch — that goes through updateMany guard
    expect(upsertArgs.update.fulfillmentStatus).toBeUndefined();

    // updateMany applies the forward-only patch with current ≠ SHIPPED guard
    expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "so1", fulfillmentStatus: { not: "SHIPPED" } },
      data: {
        fulfillmentStatus: "SHIPPED",
        shippedAt: new Date("2026-06-14T10:00:00.000Z"),
      },
    });
  });

  it("does NOT touch fulfillmentStatus when status is not SHIPPED", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    await handler.handle(row(makePayload({ wms_status: "PROCESSING" })) as any);

    const upsertArgs = prisma.salesOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.create.fulfillmentStatus).toBeUndefined();
    expect(upsertArgs.update.fulfillmentStatus).toBeUndefined();
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
  });
});
