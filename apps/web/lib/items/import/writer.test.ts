import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createItemsFromImport, ItemImportSkuTakenError } from "./writer";
import type { ItemImportPlan } from "./types";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("createItemsFromImport (test bed only)", () => {
  let token = "";
  let uomId = "";
  let skus: string[] = [];

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10).toUpperCase();
    uomId = "";
    skus = [`TEST-IMP-${token}-A`, `TEST-IMP-${token}-B`];
    const uom = await prisma.uOM.create({ data: { code: `TIMP${token}`, nameId: "test", nameEn: "test" } });
    uomId = uom.id;
  });

  afterEach(async () => {
    const items = await prisma.item.findMany({ where: { sku: { in: skus } }, select: { id: true } });
    const ids = items.map((i) => i.id);
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.item.deleteMany({ where: { sku: { in: skus } } });
    if (uomId !== "") await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const plan = (): ItemImportPlan => ({
    items: [
      {
        sku: skus[0],
        nameId: "Kemeja Test",
        nameEn: "Test Shirt",
        uomId,
        categoryId: null,
        sellingPrice: 250000,
        description: null,
        variants: [{ Warna: "Merah", Ukuran: "M", sku: `${skus[0]}-MERAH-M` }],
      },
      {
        sku: skus[1],
        nameId: "Syal Test",
        nameEn: "Syal Test",
        uomId,
        categoryId: null,
        sellingPrice: null,
        description: "desc",
        variants: [],
      },
    ],
  });

  it("creates every item as an ERP finished good with one zero-quantity variantless inventory row and no ledger entry", async () => {
    const created = await createItemsFromImport(plan());
    expect(created.map((c) => c.sku)).toEqual(skus);

    const items = await prisma.item.findMany({ where: { sku: { in: skus } }, orderBy: { sku: "asc" } });
    expect(items.map((i) => [i.type, i.source, i.isActive])).toEqual([
      ["FINISHED_GOOD", "ERP", true],
      ["FINISHED_GOOD", "ERP", true],
    ]);
    expect(items[0].variants).toEqual([{ Warna: "Merah", Ukuran: "M", sku: `${skus[0]}-MERAH-M` }]);

    const inv = await prisma.inventoryValue.findMany({ where: { itemId: { in: items.map((i) => i.id) } } });
    expect(inv).toHaveLength(2);
    expect(inv.every((r) => r.variantSku === null && Number(r.qtyOnHand) === 0)).toBe(true);

    const ledger = await prisma.stockLedgerEntry.count({ where: { itemId: { in: items.map((i) => i.id) } } });
    expect(ledger).toBe(0);
  });

  it("creates nothing when one artikel SKU is taken mid-batch", async () => {
    await prisma.item.create({
      data: { sku: skus[1], nameId: "already", nameEn: "already", type: "FINISHED_GOOD", uomId },
    });
    await expect(createItemsFromImport(plan())).rejects.toBeInstanceOf(ItemImportSkuTakenError);
    expect(await prisma.item.count({ where: { sku: skus[0] } })).toBe(0);
  });
});
