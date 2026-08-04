import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { loadSmartRequestCandidates } from "./load-candidates";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("loadSmartRequestCandidates (test bed only)", () => {
  const sku = `TEST-FSQ-SRC-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let categoryId = "";
  let itemAId = "";
  let itemBId = "";
  let inactiveItemId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const category = await prisma.itemCategory.create({ data: { code: `C-${sku}`, name: "Test Category", isActive: true } });
    categoryId = category.id;

    const itemA = await prisma.item.create({
      data: {
        sku: `${sku}-A`, nameId: "A", nameEn: "A", type: "FINISHED_GOOD", uomId, isActive: true, categoryId,
        variants: [{ sku: `${sku}-A-S`, size: "S" }, { sku: `${sku}-A-M`, size: "M" }],
      },
    });
    itemAId = itemA.id;
    await prisma.inventoryValue.create({ data: { itemId: itemAId, variantSku: `${sku}-A-S`, qtyOnHand: 10, reservedQty: 2 } });
    await prisma.inventoryValue.create({ data: { itemId: itemAId, variantSku: `${sku}-A-M`, qtyOnHand: 5, reservedQty: 0 } });

    // Second active FG in the same category, no variants at all (variantless bucket).
    const itemB = await prisma.item.create({
      data: { sku: `${sku}-B`, nameId: "B", nameEn: "B", type: "FINISHED_GOOD", uomId, isActive: true, categoryId },
    });
    itemBId = itemB.id;

    // Inactive item in the same category — must be excluded.
    const inactive = await prisma.item.create({
      data: { sku: `${sku}-C`, nameId: "C", nameEn: "C", type: "FINISHED_GOOD", uomId, isActive: false, categoryId },
    });
    inactiveItemId = inactive.id;
  });

  afterEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [itemAId, itemBId, inactiveItemId] } } });
    await prisma.item.deleteMany({ where: { id: { in: [itemAId, itemBId, inactiveItemId] } } });
    await prisma.itemCategory.deleteMany({ where: { id: categoryId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("returns active FG items keyed by category, with trimmed variants and available = qtyOnHand - reservedQty", async () => {
    const byCategory = await loadSmartRequestCandidates([categoryId]);
    const list = byCategory.get(categoryId) ?? [];
    expect(list).toHaveLength(2);

    const candA = list.find((c) => c.itemId === itemAId);
    expect(candA).toBeDefined();
    expect(candA!.variants).toEqual([
      { variantSku: `${sku}-A-S`, size: "S" },
      { variantSku: `${sku}-A-M`, size: "M" },
    ]);
    expect(candA!.available[`${sku}-A-S`]).toBe(8);
    expect(candA!.available[`${sku}-A-M`]).toBe(5);

    const candB = list.find((c) => c.itemId === itemBId);
    expect(candB).toBeDefined();
    expect(candB!.variants).toEqual([]);

    expect(list.some((c) => c.itemId === inactiveItemId)).toBe(false);
  });
});
