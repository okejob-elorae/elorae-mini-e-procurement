import { Test } from "@nestjs/testing";
import { markJubelioCreateRequested, recordJubelioObservedPrice } from "@elorae/db";
import { ProductPushHandler } from "./product-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { JubelioImageUploadService } from "../../image-upload.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

jest.mock("@elorae/db", () => ({
  ...jest.requireActual("@elorae/db"),
  markJubelioCreateRequested: jest.fn().mockResolvedValue(true),
  recordJubelioObservedPrice: jest.fn().mockResolvedValue(true),
}));

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
  jubelioConfirmedPrice: 100000,
  jubelioCreateRequestedAt: null,
  isActive: true,
  salesChannel: "BOTH",
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
  let http: { post: jest.Mock; delete: jest.Mock; get: jest.Mock };
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
    // The read-before-write of a mapped item (P75): no group listed = nothing recorded.
    http = { post: jest.fn(), delete: jest.fn(), get: jest.fn().mockResolvedValue({ data: [], totalCount: 0 }) };
    imageUpload = { ensureUploaded: jest.fn().mockResolvedValue(undefined) };
    jest.mocked(markJubelioCreateRequested).mockClear();
    jest.mocked(recordJubelioObservedPrice).mockReset().mockResolvedValue(true);
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

  it("REMOVES a variant: DELETE runs before the mapping delete, and a failed mapping delete fails the row", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
      { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });
    const callOrder: string[] = [];
    http.delete.mockImplementation(async () => { callOrder.push("http.delete"); return { status: "ok" }; });
    prisma.jubelioProductMapping.deleteMany.mockImplementation(async () => {
      callOrder.push("deleteMany");
      throw new Error("connection lost");
    });

    await expect(handler.handle(row() as any)).rejects.toThrow("connection lost");
    expect(callOrder).toEqual(["http.delete", "deleteMany"]);
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

  describe("variant images on a variant's first push", () => {
    const redImage = {
      id: "img_red",
      variantSku: "SKU-1-RED",
      url: "https://cdn.example/red.jpg",
      sortOrder: 0,
      jubelioImageId: null,
      jubelioImageKey: "https://jubelio.example/red.jpg",
      jubelioImageThumbnail: "https://jubelio.example/red-thumb.jpg",
    };
    const newMappings = [
      { id: "m_red", itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, jubelioItemCode: "SKU-1-RED", erpVariantSku: "SKU-1-RED" },
      { id: "m_blu", itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 12, jubelioItemCode: "SKU-1-BLU", erpVariantSku: "SKU-1-BLU" },
    ];

    beforeEach(() => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] });
      prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
      prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
      http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11, 12] });
    });

    it("pushes again once the new mappings exist, so the new variant's images are sent", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(newMappings);
      prisma.itemImage.findMany.mockResolvedValue([redImage]);

      await handler.handle(row() as any);

      expect(http.post).toHaveBeenCalledTimes(2);
      expect(http.post.mock.calls[0][1].variation_images).toEqual([]);
      expect(http.post.mock.calls[1][1].variation_images).toEqual([
        { item_id: 11, images: [expect.objectContaining({ url: "https://jubelio.example/red.jpg" })] },
      ]);
    });

    it("skips the re-push rather than create again when a variant is still unmapped", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.itemImage.findMany.mockResolvedValue([redImage]);

      await handler.handle(row() as any);

      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it("pushes once when no newly mapped variant has an uploaded image", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
      prisma.itemImage.findMany.mockResolvedValue([{ ...redImage, variantSku: null }]);

      await handler.handle(row() as any);

      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it("pushes once when the variant was already mapped", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue(newMappings);
      prisma.itemImage.findMany.mockResolvedValue([redImage]);

      await handler.handle(row() as any);

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post.mock.calls[0][1].variation_images).toEqual([
        { item_id: 11, images: [expect.objectContaining({ url: "https://jubelio.example/red.jpg" })] },
      ]);
    });

    it("the variant-image re-push carries the confirmed price too", async () => {
      prisma.item.findUnique.mockResolvedValue({
        ...baseItem,
        variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }],
        sellingPrice: 175000,
        jubelioConfirmedPrice: 150000,
      });
      prisma.jubelioProductMapping.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(newMappings);
      prisma.itemImage.findMany.mockResolvedValue([redImage]);

      await handler.handle(row() as any);

      expect(http.post).toHaveBeenCalledTimes(2);
      for (const [, body] of http.post.mock.calls) {
        expect(body.sell_price).toBe(150000);
        expect(body.product_skus.map((s: { sell_price: number }) => s.sell_price)).toEqual([150000, 150000]);
      }
    });
  });

  /*
   * Owner decision 2026-11-02: the ERP is the price master and Jubelio only ever receives the price
   * confirmed in the ERP. A typed price waits on Jubelio -> Konfirmasi harga; a new product is not
   * created in Jubelio until its price is confirmed.
   */
  describe("confirmed price only", () => {
    const mapped = [{ id: "m1", erpVariantSku: "", jubelioItemId: 11, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1" }];

    beforeEach(() => {
      prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
      prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
      http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });
    });

    it("a non-price edit of a mapped item pushes the confirmed price, never the unconfirmed ERP price", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, sellingPrice: 175000, jubelioConfirmedPrice: 150000 });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      const body = http.post.mock.calls[0][1];
      expect(body.sell_price).toBe(150000);
      expect(body.product_skus.map((s: { sell_price: number }) => s.sell_price)).toEqual([150000]);
    });

    it.each([
      ["no", null],
      ["a zero", 0],
    ])("SKIPs a mapped item with %s confirmed price instead of pushing sell_price 0", async (_label, confirmed) => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, jubelioConfirmedPrice: confirmed });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_NOT_CONFIRMED });
      expect(http.post).not.toHaveBeenCalled();
      expect(markJubelioCreateRequested).not.toHaveBeenCalled();
    });

    it("does not create an unconfirmed new product: it stamps the request instead, so the item waits on the list", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, jubelioConfirmedPrice: null, jubelioCreateRequestedAt: null });
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_NOT_CONFIRMED });
      expect(markJubelioCreateRequested).toHaveBeenCalledWith(prisma, "item_1", "user_1");
      expect(http.post).not.toHaveBeenCalled();
      expect(prisma.jubelioProductMapping.upsert).not.toHaveBeenCalled();
    });

    it("does not create a product whose request is still waiting for confirmation, and stamps nothing", async () => {
      prisma.item.findUnique.mockResolvedValue({
        ...baseItem,
        jubelioConfirmedPrice: 150000,
        jubelioCreateRequestedAt: new Date("2026-11-02T03:00:00.000Z"),
      });
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_NOT_CONFIRMED });
      expect(markJubelioCreateRequested).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });

    it("creates the product once its price is confirmed, at that price", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, sellingPrice: 150000, jubelioConfirmedPrice: 150000, jubelioCreateRequestedAt: null });
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      expect(http.post).toHaveBeenCalledWith("/inventory/catalog/", expect.objectContaining({ item_group_id: 0, sell_price: 150000 }));
      expect(http.post.mock.calls[0][1].product_skus[0].sell_price).toBe(150000);
      expect(prisma.jubelioProductMapping.upsert).toHaveBeenCalledTimes(1);
      expect(markJubelioCreateRequested).not.toHaveBeenCalled();
    });
  });
  /*
   * Owner answers 2026-11-02: P3a ("Toko offline saja" is never sent to Jubelio), P72 (a product
   * already in Jubelio that becomes offline-only is deactivated, not deleted) and P75 (while Jubelio
   * shows a price other than the confirmed one and nobody decided it, nothing is sent).
   */
  describe("sales channel and the price-difference hold", () => {
    const mapped = [{ id: "m1", erpVariantSku: "", jubelioItemId: 11, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1" }];
    const t = (iso: string) => new Date(iso);

    beforeEach(() => {
      prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
      prisma.jubelioCategoryMapping.findFirst.mockResolvedValue({ jubelioCategoryId: 454 });
      http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });
    });

    function jubelioShows(prices: number[]) {
      http.get.mockResolvedValue({
        data: [
          {
            item_group_id: 7,
            item_name: "Shirt",
            variants: prices.map((p, i) => ({ item_group_id: 7, item_id: 11 + i, item_code: `SKU-1-${i}`, sell_price: p })),
          },
        ],
        totalCount: 1,
      });
    }

    it("SKIPs an unmapped Toko offline saja item before any price check: no request stamped, nothing sent", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, salesChannel: "OFFLINE", jubelioConfirmedPrice: null });
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.SALES_CHANNEL_OFFLINE });
      expect(markJubelioCreateRequested).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });

    it("deactivates a mapped Toko offline saja item in Jubelio with the confirmed price, deleting nothing", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, salesChannel: "OFFLINE", jubelioConfirmedPrice: 150000 });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      const body = http.post.mock.calls[0][1];
      expect(body.is_active).toBe(false);
      expect(body.sell_price).toBe(150000);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it("HOLDS a mapped item whose Jubelio price differs with no decision: no upload, no POST", async () => {
      prisma.item.findUnique.mockResolvedValue({
        ...baseItem,
        jubelioConfirmedPrice: 150000,
        jubelioObservedAt: t("2026-11-03T01:00:00Z"),
        jubelioObservedChangedAt: t("2026-11-03T01:00:00Z"),
        jubelioObservedPriceMax: 175000,
        jubelioObservedPriceMin: 175000,
        jubelioPriceDecidedAt: null,
      });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_DIFFERS_HELD });
      expect(imageUpload.ensureUploaded).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });

    it("pushes when an admin decided the price after Jubelio's reading changed", async () => {
      prisma.item.findUnique.mockResolvedValue({
        ...baseItem,
        jubelioConfirmedPrice: 150000,
        jubelioObservedAt: t("2026-11-03T01:00:00Z"),
        jubelioObservedChangedAt: t("2026-11-03T01:00:00Z"),
        jubelioObservedPriceMax: 175000,
        jubelioObservedPriceMin: 175000,
        jubelioPriceDecidedAt: t("2026-11-03T02:00:00Z"),
      });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      expect(http.post.mock.calls[0][1].sell_price).toBe(150000);
    });

    it("HOLDS when Jubelio changed again after the decision", async () => {
      prisma.item.findUnique.mockResolvedValue({
        ...baseItem,
        jubelioConfirmedPrice: 150000,
        jubelioObservedAt: t("2026-11-03T03:00:00Z"),
        jubelioObservedChangedAt: t("2026-11-03T03:00:00Z"),
        jubelioObservedPriceMax: 180000,
        jubelioObservedPriceMin: 180000,
        jubelioPriceDecidedAt: t("2026-11-03T02:00:00Z"),
      });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_DIFFERS_HELD });
      expect(http.post).not.toHaveBeenCalled();
    });

    it("reads Jubelio BEFORE writing and records what it shows, so an edit made since the last reading holds the push", async () => {
      jubelioShows([175000, 175000]);
      const fresh = {
        ...baseItem,
        jubelioConfirmedPrice: 150000,
        jubelioObservedAt: t("2026-11-03T04:00:00Z"),
        jubelioObservedChangedAt: t("2026-11-03T04:00:00Z"),
        jubelioObservedPriceMax: 175000,
        jubelioObservedPriceMin: 175000,
        jubelioPriceDecidedAt: t("2026-11-03T02:00:00Z"),
      };
      // First read: last known reading agreed with the ERP; the re-read after recording sees the edit.
      prisma.item.findUnique
        .mockResolvedValueOnce({ ...baseItem, jubelioConfirmedPrice: 150000 })
        .mockResolvedValueOnce(fresh);
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_DIFFERS_HELD });
      expect(http.get).toHaveBeenCalledWith("/inventory/items/", expect.objectContaining({ redactResponseBody: true }));
      expect(recordJubelioObservedPrice).toHaveBeenCalledWith(prisma, "item_1", { highest: "175000", lowest: "175000" }, expect.any(Date));
      expect(http.post).not.toHaveBeenCalled();
    });

    /*
     * The same variants the ingest and the observer read (summarizeGroupsPrice): a bundle variant
     * or an unreadable item code never enters the reading, so the push records exactly what the
     * other two record and its own read never moves jubelioObservedChangedAt past a decision.
     */
    it("reads Jubelio through the ingest's variant rule: bundles and unreadable item codes are not part of the price", async () => {
      http.get.mockResolvedValue({
        data: [
          {
            item_group_id: 7,
            item_name: "Shirt",
            sell_price: "90000",
            variants: [
              { item_group_id: 7, item_id: 11, item_code: "SKU-1", sell_price: 150000 },
              { item_group_id: 7, item_id: 12, item_code: "SKU-1-PAKET", is_bundle: true, sell_price: 400000 },
              { item_group_id: 7, item_id: 13, item_code: " ", sell_price: 1 },
            ],
          },
          // The list repeating a row: counted once, its last listing winning (as the ingest keeps it).
          { item_group_id: 7, item_name: "Shirt", sell_price: "90000", variants: [{ item_group_id: 7, item_id: 11, item_code: "SKU-1", sell_price: 150000 }] },
        ],
        totalCount: 2,
      });
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, jubelioConfirmedPrice: 150000 });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      expect(jest.mocked(recordJubelioObservedPrice).mock.calls[0]).toEqual([prisma, "item_1", { highest: "150000", lowest: "150000" }, expect.any(Date)]);
    });

    it("a never-observed item is not held, and its successful push records the confirmed price as what Jubelio shows", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, jubelioConfirmedPrice: 150000 });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);
      let lastPostAt = 0;
      http.post.mockImplementation(async () => {
        lastPostAt = Date.now();
        return { status: "ok", id: 7, item_ids: [11] };
      });

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
      expect(recordJubelioObservedPrice).toHaveBeenLastCalledWith(prisma, "item_1", { highest: 150000, lowest: 150000 }, expect.any(Date));
      const calls = jest.mocked(recordJubelioObservedPrice).mock.calls;
      const sentAt = calls[calls.length - 1][3] as Date;
      expect(sentAt.getTime()).toBeLessThanOrEqual(lastPostAt);
    });

    it("a failing record after a successful push is logged and the row still counts as processed", async () => {
      prisma.item.findUnique.mockResolvedValue({ ...baseItem, jubelioConfirmedPrice: 150000 });
      prisma.jubelioProductMapping.findMany.mockResolvedValue(mapped);
      jest.mocked(recordJubelioObservedPrice).mockRejectedValue(new Error("db down"));

      const r = await handler.handle(row() as any);

      expect(r).toEqual({ kind: "processed" });
    });
  });
});
