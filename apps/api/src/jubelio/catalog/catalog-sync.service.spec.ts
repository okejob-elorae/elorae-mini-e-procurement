import { Logger } from "@nestjs/common";
import { JubelioCatalogSyncService, ensureInventoryRows, limitToErpVariants } from "./catalog-sync.service";
import type { CatalogItemDraft, JubelioItemGroup } from "./catalog.types";
import { buildCatalogDrafts } from "./map-catalog";

describe("ensureInventoryRows", () => {
  let tx: any;

  const variantless = { variantless: true, variants: [] } as unknown as CatalogItemDraft;

  beforeEach(() => {
    tx = {
      inventoryValue: {
        findFirst: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  });

  it("creates nothing when a null-spelled variantless row already exists", async () => {
    tx.inventoryValue.findFirst.mockResolvedValue({ id: "row-null" });

    await ensureInventoryRows(tx, "item-1", variantless);

    expect(tx.inventoryValue.findFirst).toHaveBeenCalledWith({
      where: { itemId: "item-1", OR: [{ variantSku: null }, { variantSku: "" }] },
      select: { id: true },
    });
    expect(tx.inventoryValue.createMany).not.toHaveBeenCalled();
  });

  it("creates nothing when a blank-spelled variantless row already exists", async () => {
    tx.inventoryValue.findFirst.mockResolvedValue({ id: "row-blank" });

    await ensureInventoryRows(tx, "item-1", variantless);

    expect(tx.inventoryValue.createMany).not.toHaveBeenCalled();
  });

  it("provisions a blank-spelled zero row when the item has no variantless row", async () => {
    tx.inventoryValue.findFirst.mockResolvedValue(null);

    await ensureInventoryRows(tx, "item-1", variantless);

    expect(tx.inventoryValue.createMany).toHaveBeenCalledWith({
      data: [{ itemId: "item-1", variantSku: "", qtyOnHand: 0, avgCost: 0, totalValue: 0 }],
      skipDuplicates: true,
    });
  });

  it("creates one row per variant SKU without a lookup for a variant draft", async () => {
    const draft = {
      variantless: false,
      variants: [{ sku: "A-S" }, { sku: "A-M" }],
    } as unknown as CatalogItemDraft;

    await ensureInventoryRows(tx, "item-1", draft);

    expect(tx.inventoryValue.findFirst).not.toHaveBeenCalled();
    expect(tx.inventoryValue.createMany).toHaveBeenCalledWith({
      data: [
        { itemId: "item-1", variantSku: "A-S", qtyOnHand: 0, avgCost: 0, totalValue: 0 },
        { itemId: "item-1", variantSku: "A-M", qtyOnHand: 0, avgCost: 0, totalValue: 0 },
      ],
      skipDuplicates: true,
    });
  });
});

describe("JubelioCatalogSyncService.syncCatalog paging", () => {
  let prisma: any;
  let http: { get: jest.Mock };
  let service: JubelioCatalogSyncService;

  /* A full page of 200 groups, so the pager has to ask for the next one. */
  function fullPage(startGroupId: number) {
    return Array.from({ length: 200 }, (_, i) => ({
      item_group_id: startGroupId + i,
      item_name: `G${startGroupId + i}`,
      variants: [],
    }));
  }

  beforeEach(() => {
    prisma = { jubelioCategoryMapping: { findMany: jest.fn().mockResolvedValue([]) } };
    http = { get: jest.fn() };
    service = new JubelioCatalogSyncService(prisma, http as any);
  });

  it("pages /inventory/items/ for a single-group sync and stops once that group has been read", async () => {
    http.get
      .mockResolvedValueOnce({ data: fullPage(1), totalCount: 5000 })
      .mockResolvedValueOnce({ data: fullPage(201), totalCount: 5000 })
      .mockResolvedValue({ data: fullPage(401), totalCount: 5000 });

    const result = await service.syncCatalog({ dryRun: true, itemGroupIds: [250] });

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenNthCalledWith(1, "/inventory/items/", { query: { page: 1, pageSize: 200 } });
    expect(http.get).toHaveBeenNthCalledWith(2, "/inventory/items/", { query: { page: 2, pageSize: 200 } });
    expect(result.dryRun).toBe(true);
  });
});

/*
 * Every Jubelio product webhook runs this sync. A selling price is typed by hand in the ERP
 * (owner decisions 2026-11-01/02), so re-ingesting an item must never touch it; only an item the
 * ERP does not have yet may take Jubelio's sell_price, and that price is recorded as the
 * confirmed Jubelio price. For an existing item, the sync may only record what Jubelio holds when
 * no confirmed price exists yet (recordJubelioPriceOnMapping, one guarded raw UPDATE).
 */
describe("JubelioCatalogSyncService.syncCatalog selling price", () => {
  let prisma: any;
  let tx: any;
  let http: { get: jest.Mock };
  let service: JubelioCatalogSyncService;
  let warn: jest.SpyInstance;

  function group(sellPrice: string | number | undefined): JubelioItemGroup {
    return {
      item_group_id: 7,
      item_name: "Cargo Pants",
      sell_price: sellPrice,
      variants: [
        { item_group_id: 7, item_id: 1, item_code: "27000015P-L", variation_values: [{ label: "Ukuran", value: "L" }] },
        { item_group_id: 7, item_id: 2, item_code: "27000015P-S", variation_values: [{ label: "Ukuran", value: "S" }] },
      ],
    };
  }

  function serveGroup(sellPrice: string | number | undefined) {
    http.get.mockImplementation((path: string) =>
      path === "/inventory/items/"
        ? Promise.resolve({ data: [group(sellPrice)], totalCount: 1 })
        : Promise.reject(new Error("no image detail in this test")),
    );
  }

  const itemSku = buildCatalogDrafts({ data: [group("1")] }).drafts[0].itemSku;

  beforeEach(() => {
    tx = {
      item: {
        create: jest.fn().mockResolvedValue({ id: "item-new" }),
        update: jest.fn().mockResolvedValue({ id: "item-1" }),
        findUnique: jest.fn().mockResolvedValue({ salesChannel: "BOTH" }),
      },
      inventoryValue: { findFirst: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jubelioProductMapping: { upsert: jest.fn().mockResolvedValue({}) },
      jubelioOutbox: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma = {
      jubelioCategoryMapping: { findMany: jest.fn().mockResolvedValue([]) },
      uOM: { findUnique: jest.fn().mockResolvedValue({ id: "uom-pcs" }) },
      item: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
    };
    http = { get: jest.fn() };
    service = new JubelioCatalogSyncService(prisma, http as any);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    ["a different", "150000"],
    ["an empty", ""],
    ["no", undefined],
  ])("re-ingesting an existing item with %s sell_price leaves its selling price unchanged", async (_label, sellPrice) => {
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [] }]);
    serveGroup(sellPrice);

    const result = await service.syncCatalog({ itemGroupIds: [7] });

    expect(result.summary.updated).toBe(1);
    expect(result.summary.errors).toBe(0);
    expect(tx.item.create).not.toHaveBeenCalled();
    expect(tx.item.update).toHaveBeenCalledTimes(1);
    const { where, data } = tx.item.update.mock.calls[0][0];
    expect(where).toEqual({ id: "item-1" });
    expect(data).not.toHaveProperty("sellingPrice");
    for (const kolom of ["jubelioConfirmedPrice", "jubelioConfirmedAt", "jubelioConfirmedById", "jubelioCreateRequestedAt", "jubelioCreateRequestedById"]) {
      expect(data).not.toHaveProperty(kolom);
    }
    expect(data.nameId).toBe("Cargo Pants");
  });

  it("re-ingesting an existing item records Jubelio's price only through the guarded UPDATE, never on sellingPrice", async () => {
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [] }]);
    serveGroup("150000");

    await service.syncCatalog({ itemGroupIds: [7] });

    // First the confirmation backstop, then what Jubelio shows (recordJubelioObservedPrice).
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const sql = tx.$executeRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.values).toEqual(expect.arrayContaining(["150000.00", "item-1"]));
    // The statement writes the confirmation columns only, and only when none is confirmed yet.
    expect(sql.sql).toMatch(/jubelioConfirmedPrice/);
    expect(sql.sql).not.toMatch(/sellingPrice/);
    expect(sql.sql).toMatch(/IS NULL/);
  });

  it.each([
    ["an empty", ""],
    ["no", undefined],
  ])("re-ingesting an existing item with %s sell_price records nothing", async (_label, sellPrice) => {
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [] }]);
    serveGroup(sellPrice);

    await service.syncCatalog({ itemGroupIds: [7] });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("a new item still takes Jubelio's sell_price, recorded as the confirmed Jubelio price", async () => {
    serveGroup("150000");

    const result = await service.syncCatalog({ itemGroupIds: [7] });

    expect(result.summary.created).toBe(1);
    expect(tx.item.update).not.toHaveBeenCalled();
    expect(tx.item.create).toHaveBeenCalledTimes(1);
    const { data } = tx.item.create.mock.calls[0][0];
    expect(data.sku).toBe(itemSku);
    expect(String(data.sellingPrice)).toBe("150000");
    expect(String(data.jubelioConfirmedPrice)).toBe("150000");
    expect(data.jubelioConfirmedAt).toBeInstanceOf(Date);
    expect(data.jubelioConfirmedById).toBeNull();
    expect(data).not.toHaveProperty("jubelioCreateRequestedAt");
  });

  it.each([
    ["an empty", ""],
    ["a zero", "0"],
  ])("a new item with %s sell_price confirms nothing", async (_label, sellPrice) => {
    serveGroup(sellPrice);

    await service.syncCatalog({ itemGroupIds: [7] });

    const { data } = tx.item.create.mock.calls[0][0];
    expect(data.jubelioConfirmedPrice).toBeNull();
    expect(data.jubelioConfirmedAt).toBeNull();
  });
});

/*
 * Owner answers P1/P2/P75 (2026-11-02): every ingest of a mapped group records what Jubelio shows
 * (highest and lowest variant price) with the read time taken BEFORE the fetch, and an ERP edit that
 * never reached Jubelio (pushes held for a price difference, or an offline-only item) is not undone.
 */
describe("JubelioCatalogSyncService.syncCatalog observed Jubelio price", () => {
  let prisma: any;
  let tx: any;
  let http: { get: jest.Mock };
  let service: JubelioCatalogSyncService;
  let warn: jest.SpyInstance;

  const group: JubelioItemGroup = {
    item_group_id: 7,
    item_name: "Cargo Pants Jubelio",
    sell_price: "90000",
    variants: [
      { item_group_id: 7, item_id: 1, item_code: "27000015P-L", sell_price: 110000, variation_values: [{ label: "Ukuran", value: "L" }] },
      { item_group_id: 7, item_id: 2, item_code: "27000015P-S", sell_price: 100000, variation_values: [{ label: "Ukuran", value: "S" }] },
    ],
  };
  const itemSku = buildCatalogDrafts({ data: [group] }).drafts[0].itemSku;
  let fetchStartedAt = 0;

  beforeEach(() => {
    tx = {
      item: {
        create: jest.fn().mockResolvedValue({ id: "item-new" }),
        update: jest.fn().mockResolvedValue({ id: "item-1" }),
        findUnique: jest.fn().mockResolvedValue({ salesChannel: "BOTH" }),
      },
      inventoryValue: { findFirst: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jubelioProductMapping: { upsert: jest.fn().mockResolvedValue({}) },
      jubelioOutbox: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      jubelioCategoryMapping: { findMany: jest.fn().mockResolvedValue([]) },
      uOM: { findUnique: jest.fn().mockResolvedValue({ id: "uom-pcs" }) },
      item: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
    };
    http = {
      get: jest.fn((path: string) => {
        if (path === "/inventory/items/") {
          fetchStartedAt = Date.now();
          return Promise.resolve({ data: [group], totalCount: 1 });
        }
        return Promise.reject(new Error("no image detail in this test"));
      }),
    };
    service = new JubelioCatalogSyncService(prisma, http as any);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function observedCall() {
    const call = tx.$executeRaw.mock.calls.find((c: any[]) => /jubelioObservedPriceMax/.test((c[0] as { sql: string }).sql));
    return call?.[0] as { sql: string; values: unknown[] } | undefined;
  }

  it("records the highest and lowest variant price with the read time taken before the fetch, never sellingPrice", async () => {
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [] }]);

    await service.syncCatalog({ itemGroupIds: [7] });

    const sql = observedCall();
    expect(sql).toBeDefined();
    expect(sql!.sql).not.toMatch(/sellingPrice/);
    expect(sql!.values).toEqual(expect.arrayContaining(["110000.00", "100000.00", "item-1"]));
    const readAt = sql!.values.find((v) => v instanceof Date) as Date;
    expect(readAt.getTime()).toBeLessThanOrEqual(fetchStartedAt);
    const { data } = tx.item.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("sellingPrice");
  });

  it("a new item takes the highest price as selling, confirmed and observed price", async () => {
    await service.syncCatalog({ itemGroupIds: [7] });

    const { data } = tx.item.create.mock.calls[0][0];
    expect(String(data.sellingPrice)).toBe("110000");
    expect(String(data.jubelioConfirmedPrice)).toBe("110000");
    expect(data).toMatchObject({ salesChannel: "BOTH", jubelioObservedPriceMax: "110000.00", jubelioObservedPriceMin: "100000.00" });
    expect(data.jubelioObservedAt).toBeInstanceOf(Date);
  });

  it("an unknown price records no observation", async () => {
    const tanpaHarga = { ...group, sell_price: undefined, variants: group.variants.map((v) => ({ ...v, sell_price: undefined })) };
    http.get.mockImplementation((path: string) =>
      path === "/inventory/items/" ? Promise.resolve({ data: [tanpaHarga], totalCount: 1 }) : Promise.reject(new Error("x")),
    );
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [] }]);

    await service.syncCatalog({ itemGroupIds: [7] });

    expect(observedCall()).toBeUndefined();
  });

  it.each([
    ["its pushes are held for a price difference", { salesChannel: "BOTH" }, { status: "SKIPPED", skipReason: "price_differs_held" }],
    ["it is sold in offline stores only", { salesChannel: "OFFLINE" }, null],
  ])("keeps the ERP name and variants when %s", async (_label, item, latest) => {
    tx.item.findUnique.mockResolvedValue(item);
    tx.jubelioOutbox.findFirst.mockResolvedValue(latest);
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [{ sku: "27000015P-L" }] }]);

    const result = await service.syncCatalog({ itemGroupIds: [7] });

    const { data } = tx.item.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("nameId");
    expect(data).not.toHaveProperty("variants");
    expect(result.summary.warnings.some((w) => /kept as in the ERP/.test(w))).toBe(true);
    // The Jubelio reading covers every Jubelio variant (110000 is L, 100000 is S), like the observer's.
    expect(observedCall()!.values).toEqual(expect.arrayContaining(["110000.00", "100000.00", "item-1"]));
  });

  /*
   * A variant someone added in Jubelio (27000015P-S) while the item's ERP edits are not reaching
   * Jubelio is NOT mapped: the next push — the release, a Kirim ulang, a confirmation or the P72
   * (de)activation — DELETEs in Jubelio every mapping the ERP variants do not name, so mapping it
   * here would delete it there. Only the variant the ERP lists gets its mapping and inventory row.
   */
  it.each([
    ["its pushes are held for a price difference", { salesChannel: "BOTH" }, { status: "SKIPPED", skipReason: "price_differs_held" }],
    ["it is sold in offline stores only", { salesChannel: "OFFLINE" }, null],
  ])("maps only the variants the ERP lists when %s, so the next push deletes nothing in Jubelio", async (_label, item, latest) => {
    tx.item.findUnique.mockResolvedValue(item);
    tx.jubelioOutbox.findFirst.mockResolvedValue(latest);
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [{ sku: "27000015P-L" }] }]);

    const result = await service.syncCatalog({ itemGroupIds: [7] });

    const mapped = tx.jubelioProductMapping.upsert.mock.calls.map((c: any[]) => c[0].where.jubelioItemId);
    expect(mapped).toEqual([1]);
    const rows = tx.inventoryValue.createMany.mock.calls.flatMap((c: any[]) => c[0].data.map((d: { variantSku: string }) => d.variantSku));
    expect(rows).toEqual(["27000015P-L"]);
    expect(result.summary.warnings.some((w) => /1 Jubelio variant\(s\) the ERP does not list left unmapped .*reserves no ERP stock/.test(w))).toBe(true);
  });

  it("an item whose ERP edits do reach Jubelio still merges and maps every Jubelio variant", async () => {
    prisma.item.findMany.mockResolvedValue([{ id: "item-1", sku: itemSku, description: null, variants: [{ sku: "27000015P-L" }] }]);

    await service.syncCatalog({ itemGroupIds: [7] });

    const mapped = tx.jubelioProductMapping.upsert.mock.calls.map((c: any[]) => c[0].where.jubelioItemId).sort();
    expect(mapped).toEqual([1, 2]);
    expect(tx.item.update.mock.calls[0][0].data.variants.map((v: { sku: string }) => v.sku).sort()).toEqual(["27000015P-L", "27000015P-S"]);
  });
});

describe("limitToErpVariants", () => {
  const draft = (variantless: boolean, skus: string[]) =>
    ({
      variantless,
      variants: skus.map((sku) => ({ sku })),
      sourceVariants: skus.map((sku, i) => ({ jubelioItemId: i + 1, jubelioItemCode: sku, jubelioItemGroupId: 7, erpVariantSku: sku })),
    }) as unknown as CatalogItemDraft;

  it("keeps the one blank mapping when neither side has variants", () => {
    const d = draft(true, ["SKU1"]);
    expect(limitToErpVariants(d, [])).toBe(d);
    expect(limitToErpVariants(d, null)).toBe(d);
  });

  it("maps nothing when only one side has variants", () => {
    expect(limitToErpVariants(draft(false, ["A-S", "A-L"]), [])).toMatchObject({ variants: [], sourceVariants: [] });
    expect(limitToErpVariants(draft(true, ["SKU1"]), [{ sku: "A-S" }])).toMatchObject({ variantless: false, variants: [], sourceVariants: [] });
  });

  it("keeps only the Jubelio variants whose sku the ERP lists exactly", () => {
    const r = limitToErpVariants(draft(false, ["A-S", "A-L", "a-m"]), [{ sku: "A-S" }, { sku: "A-M" }]);
    expect(r.sourceVariants.map((v) => v.erpVariantSku)).toEqual(["A-S"]);
    expect(r.variants.map((v) => v.sku)).toEqual(["A-S"]);
  });
});
