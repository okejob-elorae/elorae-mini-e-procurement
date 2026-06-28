import { Test } from "@nestjs/testing";
import { ProductPushHandler } from "./product-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { JubelioImageUploadService } from "../../image-upload.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

function row(overrides: any = {}) {
  return {
    id: "out_1",
    entityType: "product_push",
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

const baseItem = {
  id: "item_1",
  sku: "SKU-1",
  nameId: "Kemeja",
  nameEn: "Shirt",
  description: "long enough description for the thirty character minimum required",
  type: "FINISHED_GOOD",
  source: "ERP",
  categoryId: "cat_1",
  variants: null,
  sellingPrice: 100000,
  isActive: true,
};

const baseDefaults = {
  sellTaxId: -1, buyTaxId: -1, salesAcctId: 28, cogsAcctId: 30, invtAcctId: 4,
  purchAcctId: null, uomId: -1, brandId: null, brandName: null,
  sellThis: true, buyThis: true, stockThis: true, dropshipThis: false, isActive: true,
  sellUnit: "Buah", buyUnit: "Buah", packageWeight: 1000,
  storePriorityQtyTreshold: 0, rop: 0,
  useSingleImageSet: false, useSerialNumber: false, buyPrice: 0,
};

describe("ProductPushHandler", () => {
  let handler: ProductPushHandler;
  let prisma: any;
  let http: { post: jest.Mock; delete: jest.Mock };
  let imageUpload: { ensureUploaded: jest.Mock };

  beforeEach(async () => {
    prisma = {
      item: { findUnique: jest.fn() },
      jubelioProductMapping: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      jubelioPushDefaults: { findFirst: jest.fn() },
      jubelioCategoryMapping: { findFirst: jest.fn() },
      itemImage: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: Promise<any>[]) => Promise.all(ops)),
    };
    http = { post: jest.fn(), delete: jest.fn() };
    imageUpload = { ensureUploaded: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        ProductPushHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
        { provide: JubelioImageUploadService, useValue: imageUpload },
      ],
    }).compile();
    handler = mod.get(ProductPushHandler);
  });

  it("SKIPs orphan_item when Item missing", async () => {
    prisma.item.findUnique.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.ORPHAN_ITEM });
  });

  it("SKIPs wrong_type for non-FINISHED_GOOD", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, type: "FABRIC" });
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.WRONG_TYPE });
  });

  it("SKIPs defaults_missing when no JubelioPushDefaults row", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.DEFAULTS_MISSING });
  });

  it("SKIPs category_unmapped when JubelioCategoryMapping missing", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED });
  });

  it("SKIPs cannot_create_from_ingested when no mappings and source=JUBELIO_INGEST", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, source: "JUBELIO_INGEST" });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.CANNOT_CREATE_FROM_INGESTED });
  });

  it("CREATES variantless: POST with item_group_id=0, inserts 1 mapping", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    const r = await handler.handle(row() as any);

    expect(http.post).toHaveBeenCalledWith("/inventory/catalog/", expect.objectContaining({
      item_group_id: 0,
    }));
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1" },
      create: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, jubelioItemCode: "SKU-1", erpVariantSku: "" },
      update: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, erpVariantSku: "" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("CREATES variants: POST + inserts 2 mappings", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11, 12] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-RED" },
      create: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, jubelioItemCode: "SKU-1-RED", erpVariantSku: "SKU-1-RED" },
      update: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, erpVariantSku: "SKU-1-RED" },
    });
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-BLU" },
      create: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 12, jubelioItemCode: "SKU-1-BLU", erpVariantSku: "SKU-1-BLU" },
      update: { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 12, erpVariantSku: "SKU-1-BLU" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("EDITS existing: reuses item_group_id, no new mappings, no DELETE", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    await handler.handle(row() as any);

    expect(http.post).toHaveBeenCalledWith("/inventory/catalog/", expect.objectContaining({
      item_group_id: 7,
    }));
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.jubelioProductMapping.deleteMany).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it("ADDS a variant: mapping inserted for new sku only", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-GRN" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11, 13] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-RED" },
      create: expect.objectContaining({ jubelioItemCode: "SKU-1-RED" }),
      update: expect.objectContaining({ jubelioItemGroupId: 7, jubelioItemId: 11 }),
    });
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-GRN" },
      create: expect.objectContaining({ jubelioItemCode: "SKU-1-GRN", jubelioItemId: 13 }),
      update: expect.objectContaining({ jubelioItemGroupId: 7, jubelioItemId: 13 }),
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it("heals stale orphan row: upsert updates jubelioItemId + itemId when code already exists", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-RED" },
      create: expect.objectContaining({
        jubelioItemCode: "SKU-1-RED",
        jubelioItemGroupId: 7,
        jubelioItemId: 11,
      }),
      update: expect.objectContaining({
        jubelioItemGroupId: 7,
        jubelioItemId: 11,
        itemId: "item_1",
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("REMOVES a variant: POST without removed sku + DELETE call + mapping dropped", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
      { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledWith({
      where: { jubelioItemCode: "SKU-1-RED" },
      create: expect.objectContaining({ jubelioItemCode: "SKU-1-RED" }),
      update: expect.objectContaining({ jubelioItemGroupId: 7, jubelioItemId: 11 }),
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(http.delete).toHaveBeenCalledWith("/inventory/items/item-variant/", expect.objectContaining({
      body: JSON.stringify({ ids: [12] }),
    }));
    expect(prisma.jubelioProductMapping.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["m2"] } },
    });
  });

  it("calls ensureUploaded BEFORE catalog POST", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    const callOrder: string[] = [];
    imageUpload.ensureUploaded.mockImplementation(async () => { callOrder.push("ensureUploaded"); });
    http.post.mockImplementation(async () => { callOrder.push("http.post"); return { status: "ok", id: 7, item_ids: [11] }; });

    await handler.handle(row() as any);

    expect(callOrder).toEqual(["ensureUploaded", "http.post"]);
  });

  it("if ensureUploaded rejects, handler throws and catalog POST is never called", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    imageUpload.ensureUploaded.mockRejectedValue(new Error("upload failed"));

    await expect(handler.handle(row() as any)).rejects.toThrow("upload failed");
    expect(http.post).not.toHaveBeenCalled();
  });
});
