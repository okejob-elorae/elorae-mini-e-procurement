import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createItem, updateItem, type ItemFormData } from "./mutations";
import { VariantBarcodeTakenError, VariantSkuTakenError } from "./variant-sku-collisions";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("createItem and updateItem refuse a cross-item SKU or barcode collision (test bed only)", () => {
  let token = "";
  let uomId = "";
  let ownerId = "";
  let editedId = "";
  let skuB = "";
  let skuC = "";
  let barcode = "";
  const createdIds: string[] = [];

  const payload = (over: Partial<ItemFormData>): ItemFormData => ({
    sku: skuB,
    nameId: "t",
    nameEn: "t",
    type: "FABRIC",
    uomId,
    ...over,
  });

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 8).toUpperCase();
    uomId = "";
    ownerId = "";
    editedId = "";
    skuB = `TST-MC-${token}-B`;
    skuC = `TST-MC-${token}-C`;
    barcode = `899${token}`;
    createdIds.length = 0;
    uomId = (await prisma.uOM.create({ data: { code: `TEST-MC-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    /* The owner holds variant SKUs that start with the prefixes of the two items under test. */
    ownerId = (
      await prisma.item.create({
        data: {
          sku: `TST-MC-${token}-A`,
          nameId: "t",
          nameEn: "t",
          type: "FABRIC",
          uomId,
          variants: [
            { Warna: "Merah", sku: `${skuB}-MERAH`, barcode },
            { Warna: "Biru", sku: `${skuC}-BIRU` },
          ],
        },
      })
    ).id;
    editedId = (
      await prisma.item.create({
        data: { sku: skuC, nameId: "t", nameEn: "t", type: "FABRIC", uomId, variants: [] },
      })
    ).id;
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: { in: createdIds.map(seededId) } } });
      await prisma.item.deleteMany({ where: { id: { in: createdIds.map(seededId) } } });
    }
    if (editedId) await prisma.item.delete({ where: { id: seededId(editedId) } });
    if (ownerId) await prisma.item.delete({ where: { id: seededId(ownerId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const edit = (variants: Array<Record<string, string>>) =>
    prisma.$transaction((tx) => updateItem(tx, editedId, payload({ sku: skuC, variants })));

  it("createItem refuses a variant SKU another item already uses", async () => {
    await expect(createItem(payload({ variants: [{ Warna: "Merah", sku: `${skuB}-MERAH` }] }))).rejects.toBeInstanceOf(
      VariantSkuTakenError,
    );
  });

  it("createItem refuses a variant barcode another item already uses", async () => {
    await expect(
      createItem(payload({ variants: [{ Warna: "Kuning", sku: `${skuB}-KUNING`, barcode }] })),
    ).rejects.toBeInstanceOf(VariantBarcodeTakenError);
  });

  it("createItem saves a variant that collides with nothing", async () => {
    const saved = await createItem(payload({ variants: [{ Warna: "Kuning", sku: `${skuB}-KUNING`, barcode: `x${barcode}` }] }));
    createdIds.push(saved.item.id);
    expect(saved.item.sku).toBe(skuB);
  });

  it("updateItem refuses a variant SKU another item already uses", async () => {
    await expect(edit([{ Warna: "Biru", sku: `${skuC}-BIRU` }])).rejects.toBeInstanceOf(VariantSkuTakenError);
  });

  it("updateItem refuses a variant barcode another item already uses", async () => {
    await expect(edit([{ Warna: "Kuning", sku: `${skuC}-KUNING`, barcode }])).rejects.toBeInstanceOf(
      VariantBarcodeTakenError,
    );
  });

  it("updateItem saves a variant that collides with nothing", async () => {
    const saved = await edit([{ Warna: "Kuning", sku: `${skuC}-KUNING`, barcode: `x${barcode}` }]);
    expect(saved.item.id).toBe(editedId);
  });
});
