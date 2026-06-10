import { Test } from "@nestjs/testing";
import { SalesOrderWebhookHandler } from "./salesorder.handler";
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
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        SalesOrderWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: AdminNotificationService, useValue: admin },
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
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
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
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
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
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
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
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce(null);
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
    prisma.jubelioProductMapping.findFirst.mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
    prisma.inventoryValue.findUnique.mockResolvedValueOnce({ qtyOnHand: 10 });
    applyMock.mockResolvedValue({});
    const payload = makePayload();
    payload.items[1].is_canceled_item = true;

    await handler.handle(row(payload) as any);

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(prisma.jubelioProductMapping.findFirst).toHaveBeenCalledTimes(1);
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
});
