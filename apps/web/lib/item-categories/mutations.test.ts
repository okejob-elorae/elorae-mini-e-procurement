import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { deleteItemCategoryRecord, ItemCategoryDeleteError, ItemCategoryError } from "./mutations";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Owner answer P8 (2026-11-02): SPG commission uses the item's category AT THE TIME OF SALE, kept
 * with its date on each sale line. An item moved to another category leaves its old sales on the
 * old one, so that category must not be deletable while a sale line still names it.
 */
d("deleteItemCategoryRecord — SPG sale lines (test bed only)", () => {
  const tag = `TEST-ICDEL-${Math.random().toString(36).slice(2, 10)}`;
  let tokoId = "";
  let uomId = "";
  let spgId = "";
  let barangId = "";
  let kategoriLamaId = "";
  let kategoriBaruId = "";
  const notaIds: string[] = [];

  beforeEach(async () => {
    tokoId = "";
    uomId = "";
    spgId = "";
    barangId = "";
    kategoriLamaId = "";
    kategoriBaruId = "";
    notaIds.length = 0;

    tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriLamaId = (await prisma.itemCategory.create({ data: { code: `${tag}-L`, name: `${tag} Lama`, isActive: true } })).id;
    kategoriBaruId = (await prisma.itemCategory.create({ data: { code: `${tag}-B`, name: `${tag} Baru`, isActive: true } })).id;
    barangId = (
      await prisma.item.create({
        data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, categoryId: kategoriLamaId },
      })
    ).id;
    spgId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-spg@uji.local`, name: `${tag} SPG`, passwordHash: "x", assignedStoreId: tokoId } })).id;

    // Sold while the item was still in the old category: the line keeps that category and its date.
    const nota = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-N1`,
        salesmanId: spgId,
        storeId: tokoId,
        subtotal: 150_000,
        total: 150_000,
        cashReceived: 150_000,
        changeGiven: 0,
        createdById: spgId,
        lines: {
          create: [
            {
              itemId: barangId,
              categoryId: kategoriLamaId,
              categoryAt: new Date("2026-10-15T10:00:00+07:00"),
              productName: `${tag} Blus`,
              qty: 1,
              unitPrice: 150_000,
              lineTotal: 150_000,
            },
          ],
        },
      },
      select: { id: true },
    });
    notaIds.push(nota.id);

    // Afterwards the item moves to another category; the old one no longer has any item.
    await prisma.item.update({ where: { id: barangId }, data: { categoryId: kategoriBaruId } });
  });

  afterEach(async () => {
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: [kategoriLamaId, kategoriBaruId].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(spgId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  });

  it("refuses a category with no item left that still carries an SPG sale line", async () => {
    await expect(deleteItemCategoryRecord(kategoriLamaId)).rejects.toBeInstanceOf(ItemCategoryDeleteError);
    await expect(deleteItemCategoryRecord(kategoriLamaId)).rejects.toMatchObject({ code: "HAS_SALE_LINES" });
    expect(await prisma.itemCategory.count({ where: { id: seededId(kategoriLamaId) } })).toBe(1);
    const baris = await prisma.spgSaleLine.findFirst({ where: { spgSaleId: { in: seededIds(notaIds) } }, select: { categoryId: true } });
    expect(baris?.categoryId).toBe(kategoriLamaId);
  });

  it("an item still in the category is reported first, as before", async () => {
    await expect(deleteItemCategoryRecord(kategoriBaruId)).rejects.toBeInstanceOf(ItemCategoryError);
    await expect(deleteItemCategoryRecord(kategoriBaruId)).rejects.toMatchObject({ code: "IN_USE", count: 1 });
  });

  it("deletes the category once no sale line names it", async () => {
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await expect(deleteItemCategoryRecord(kategoriLamaId)).resolves.toBeUndefined();
    expect(await prisma.itemCategory.count({ where: { id: seededId(kategoriLamaId) } })).toBe(0);
  });
});
