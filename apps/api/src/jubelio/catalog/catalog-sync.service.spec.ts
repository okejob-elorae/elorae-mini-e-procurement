import { JubelioCatalogSyncService, ensureInventoryRows } from "./catalog-sync.service";
import type { CatalogItemDraft } from "./catalog.types";

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
