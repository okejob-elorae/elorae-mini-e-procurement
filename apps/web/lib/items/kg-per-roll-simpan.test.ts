import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getItemById } from "./queries";
import { createItem, updateItem } from "./mutations";

/*
 * Kg per roll bahan tersimpan lewat formulir barang, dan sampai ke klien
 * sebagai angka (bukan Decimal) — terhadap basis data uji.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kg per roll di formulir barang (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-KPR-${token}`, nameId: "kg", nameEn: "kg" } })).id;
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const dasar = () => ({ nameId: "Kain uji", nameEn: "Test fabric", type: "FABRIC" as const, uomId });

  it("disimpan, tidak tersentuh bila tidak dikirim, dikosongkan bila null; angka di payload klien", async () => {
    const { item } = await createItem({ ...dasar(), sku: `TEST-KPR-${token}`, kgPerRoll: 25.5 });
    itemId = item.id;
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).kgPerRoll)).toBe(25.5);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), nameId: "Kain uji 2" }));
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).kgPerRoll)).toBe(25.5);

    const klien = await getItemById(itemId);
    expect(klien?.kgPerRoll).toBe(25.5);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), kgPerRoll: null }));
    expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).kgPerRoll).toBeNull();
  });

  it("menolak nol atau negatif", async () => {
    await expect(prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), kgPerRoll: 0 }))).rejects.toThrow(/kgPerRoll/);
    await expect(prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), kgPerRoll: -3 }))).rejects.toThrow(/kgPerRoll/);
  });
});
