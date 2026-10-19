import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createItem, updateItem, type ItemFormData } from "./mutations";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("finished-good Warna must be in the colour master (test bed only)", () => {
  let token = "";
  let uomId = "";
  let seq = 0;
  const itemIds: string[] = [];
  let colorId = "";

  const payload = (over: Partial<ItemFormData>): ItemFormData => ({
    sku: `TST-CG-${token}-${seq++}`,
    nameId: "t",
    nameEn: "t",
    type: "FINISHED_GOOD",
    uomId,
    ...over,
  });

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 8).toUpperCase();
    uomId = "";
    colorId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-CG-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    colorId = (await prisma.variantColor.create({ data: { name: `Known ${token}` } })).id;
  });

  afterEach(async () => {
    if (itemIds.length > 0) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds.map(seededId) } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds.map(seededId) } } });
    }
    itemIds.length = 0;
    if (colorId) await prisma.variantColor.delete({ where: { id: seededId(colorId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("refuses a new finished good with an unknown Warna but not a fabric", async () => {
    await expect(createItem(payload({ variants: [{ Warna: `Mystery ${token}` }] }))).rejects.toThrow(/colour master/);

    const fabric = await createItem(payload({ type: "FABRIC", variants: [{ Warna: `Mystery ${token}` }] }));
    itemIds.push(fabric.item.id);
    const fg = await createItem(payload({ variants: [{ Warna: `known ${token.toLowerCase()}`, Ukuran: "M" }] }));
    itemIds.push(fg.item.id);
  });

  it("lets an edit keep a legacy unknown Warna but refuses a newly added one", async () => {
    const legacy = await prisma.item.create({
      data: {
        sku: `TST-CG-${token}-L`,
        nameId: "t",
        nameEn: "t",
        type: "FINISHED_GOOD",
        uomId,
        variants: [{ Warna: `Cream ${token}`, sku: `TST-CG-${token}-L-CREAM` }],
      },
    });
    itemIds.push(legacy.id);
    const edit = (variants: Array<Record<string, string>>) =>
      prisma.$transaction((tx) => updateItem(tx, legacy.id, payload({ sku: legacy.sku, variants })));

    await expect(edit([{ Warna: `Cream ${token}`, sku: `TST-CG-${token}-L-CREAM` }])).resolves.toBeDefined();
    await expect(edit([{ Warna: `Cream ${token}` }, { Warna: `Teal ${token}` }])).rejects.toThrow(/Teal/);
  });
});
