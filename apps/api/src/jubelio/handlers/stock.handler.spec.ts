import { Test } from "@nestjs/testing";
import { StockWebhookHandler } from "./stock.handler";
import { PRISMA } from "../../db/prisma.module";
import { SKIP_REASONS } from "../queue/webhook-status";

jest.mock("@elorae/db", () => ({
  applyJubelioStockAdjustment: jest.fn(),
}));

import { applyJubelioStockAdjustment } from "@elorae/db";

function row(overrides: any = {}) {
  return {
    id: "evt_1",
    event: "stock",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: { item_code: "SKU-A", end_qty: "5" },
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

describe("StockWebhookHandler", () => {
  let handler: StockWebhookHandler;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findUnique: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        StockWebhookHandler,
        { provide: PRISMA, useValue: prisma },
      ],
    }).compile();
    handler = mod.get(StockWebhookHandler);
    (applyJubelioStockAdjustment as jest.Mock).mockReset();
  });

  it("returns SKIPPED orphan_sku when mapping not found", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue(null);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:SKU-A` });
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("calls applyJubelioStockAdjustment with mapped item + variant", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue({
      itemId: "item_1",
      erpVariantSku: "VAR-A",
    });
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj_1", skipped: false });

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "VAR-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "SKU-A",
      reason: "Jubelio stock webhook event evt_1",
    });
  });

  it("rethrows when applyJubelioStockAdjustment throws", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue({
      itemId: "item_1",
      erpVariantSku: "VAR-A",
    });
    (applyJubelioStockAdjustment as jest.Mock).mockRejectedValue(new Error("InventoryValue not found"));

    await expect(handler.handle(row() as any)).rejects.toThrow(/InventoryValue not found/);
  });
});
