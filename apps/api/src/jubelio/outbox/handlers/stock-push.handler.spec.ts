import { Test } from "@nestjs/testing";
import { StockPushHandler } from "./stock-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

function row(overrides: any = {}) {
  return {
    id: "out_1",
    entityType: "stock_push",
    entityId: "item_1",
    payload: {},
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    skipReason: null,
    enqueuedById: "user_1",
    createdAt: new Date(),
    lastEnqueuedAt: new Date(),
    processedAt: null,
    deadAt: null,
    ...overrides,
  };
}

describe("StockPushHandler", () => {
  let handler: StockPushHandler;
  let prisma: any;
  let http: { put: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findFirst: jest.fn() },
      inventoryValue: { findMany: jest.fn() },
    };
    http = { put: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockPushHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockPushHandler);
  });

  it("returns SKIPPED missing_mapping when item has no Jubelio mapping", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("returns SKIPPED no_inventory when item has no InventoryValue rows", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([]);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("PUTs current inventory to Jubelio and returns processed", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 5, reservedQty: 2 },
      { variantSku: "SKU-B", qtyOnHand: 12, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put).toHaveBeenCalledTimes(1);
    const [path, body] = http.put.mock.calls[0];
    expect(path).toBe("/inventory/items/42/stock");
    expect(body).toEqual({
      items: [
        { item_code: "SKU-A", end_qty: 3 },
        { item_code: "SKU-B", end_qty: 12 },
      ],
    });
  });

  it("clamps end_qty at 0 when reserved exceeds on-hand", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 4 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items[0]).toEqual({ item_code: "SKU-A", end_qty: 0 });
  });

  it("falls back to parent jubelioItemCode for variantless rows (empty variantSku)", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "", qtyOnHand: 8, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items[0]).toEqual({ item_code: "SKU-PARENT", end_qty: 8 });
  });

  it("rethrows when Jubelio call fails", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 0 },
    ]);
    http.put.mockRejectedValue(new Error("Jubelio 500"));

    await expect(handler.handle(row() as any)).rejects.toThrow(/Jubelio 500/);
  });
});
