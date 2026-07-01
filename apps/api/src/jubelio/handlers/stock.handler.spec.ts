import { Test } from "@nestjs/testing";
import { StockWebhookHandler } from "./stock.handler";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { SKIP_REASONS } from "../queue/webhook-status";

jest.mock("@elorae/db", () => ({
  applyJubelioStockAdjustment: jest.fn(),
}));

import { applyJubelioStockAdjustment } from "@elorae/db";

function row(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    event: "stock",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
    skipReason: null,
    deadAt: null,
    lastEnqueuedAt: null,
    ...overrides,
  };
}

const NEW_SHAPE = {
  action: "update-qty",
  item_group_id: 115,
  item_group_name: "Some Group",
  item_ids: [1974, 2125],
  location_id: null,
};

const DETAIL_RESPONSE = {
  item_group_id: 115,
  product_skus: [
    { item_id: 1974, item_code: "SKU-A-RED", end_qty: 7 },
    { item_id: 2125, item_code: "SKU-A-BLU", end_qty: 3 },
  ],
};

describe("StockWebhookHandler", () => {
  let handler: StockWebhookHandler;
  let prisma: {
    jubelioProductMapping: { findMany: jest.Mock };
  };
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findMany: jest.fn() },
    };
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockWebhookHandler);
    (applyJubelioStockAdjustment as jest.Mock).mockReset();
  });

  it("SKIPs old-shape payload (item_code + end_qty)", async () => {
    const result = await handler.handle(row({ item_code: "SKU-A", end_qty: 5 }) as never);
    expect(result).toEqual({
      kind: "skipped",
      reason: SKIP_REASONS.UNSUPPORTED_PAYLOAD_SHAPE,
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("SKIPs when item_group_id missing", async () => {
    const result = await handler.handle(row({ action: "update-qty", item_ids: [1] }) as never);
    expect(result).toEqual({
      kind: "skipped",
      reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID,
    });
  });

  it("SKIPs when item_ids missing or empty", async () => {
    const r1 = await handler.handle(row({ action: "update-qty", item_group_id: 1 }) as never);
    expect(r1).toEqual({ kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS });

    const r2 = await handler.handle(row({ action: "update-qty", item_group_id: 1, item_ids: [] }) as never);
    expect(r2).toEqual({ kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS });
  });

  it("SKIPs orphan_group when no local mappings match item_ids", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    http.get.mockResolvedValue(DETAIL_RESPONSE);

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(result).toEqual({
      kind: "skipped",
      reason: `${SKIP_REASONS.ORPHAN_GROUP}:115`,
    });
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("fetches group detail and applies stock adjustment per matched item_id", async () => {
    http.get.mockResolvedValue(DETAIL_RESPONSE);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
      { itemId: "item_1", erpVariantSku: "ERP-A-BLU", jubelioItemId: 2125, jubelioItemCode: "SKU-A-BLU" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj", skipped: false });

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(http.get).toHaveBeenCalledWith("/inventory/items/group/115");
    expect(applyJubelioStockAdjustment).toHaveBeenCalledTimes(2);
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "ERP-A-RED",
      newQty: 7,
      idempotencyKey: "evt_1:1974",
      externalRef: "115/SKU-A-RED",
      reason: "Jubelio stock webhook evt_1 item_id=1974",
    });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "ERP-A-BLU",
      newQty: 3,
      idempotencyKey: "evt_1:2125",
      externalRef: "115/SKU-A-BLU",
      reason: "Jubelio stock webhook evt_1 item_id=2125",
    });
    expect(result).toEqual({ kind: "processed" });
  });

  it("partial match: applies adjustment for mapped item_ids only, still processed", async () => {
    http.get.mockResolvedValue({
      item_group_id: 115,
      product_skus: [
        { item_id: 1974, item_code: "SKU-A-RED", end_qty: 7 },
        // item_id 2125 absent from detail response — Jubelio inconsistency
      ],
    });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
      { itemId: "item_1", erpVariantSku: "ERP-A-BLU", jubelioItemId: 2125, jubelioItemCode: "SKU-A-BLU" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj", skipped: false });

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(applyJubelioStockAdjustment).toHaveBeenCalledTimes(1);
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, expect.objectContaining({
      variantSku: "ERP-A-RED", newQty: 7,
    }));
    expect(result).toEqual({ kind: "processed" });
  });

  it("throws when http.get fails (queue retries)", async () => {
    http.get.mockRejectedValue(new Error("network"));
    await expect(handler.handle(row(NEW_SHAPE) as never)).rejects.toThrow(/network/);
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("throws when applyJubelioStockAdjustment fails", async () => {
    http.get.mockResolvedValue(DETAIL_RESPONSE);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockRejectedValue(new Error("InventoryValue not found"));

    await expect(handler.handle(row(NEW_SHAPE) as never)).rejects.toThrow(/InventoryValue not found/);
  });
});
