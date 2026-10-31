import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getItemById } from "./queries";
import { createItem, updateItem } from "./mutations";

/*
 * Komisi SPG per pcs tersimpan lewat formulir barang, sampai ke klien sebagai
 * angka (bukan Decimal), dan perubahannya tercatat di jejak — terhadap basis
 * data uji. Barang, satuan, dan pengguna milik tes sendiri.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("komisi SPG per pcs di formulir barang (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let kainId = "";
  let userId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    kainId = "";
    userId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-KSP-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    userId = (await prisma.user.create({ data: { email: `ksp-${token}@uji.local`, name: `KSP ${token}` } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(itemId) } });
    for (const id of [itemId, kainId].filter(Boolean)) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.item.delete({ where: { id: seededId(id) } });
    }
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const gamis = () => ({ nameId: "Gamis uji", nameEn: "Test dress", type: "FINISHED_GOOD" as const, uomId });

  it("disimpan, tidak tersentuh bila tidak dikirim, 0 bila dikosongkan; angka di payload klien; perubahan tercatat di jejak", async () => {
    const { item } = await createItem({ ...gamis(), sku: `TEST-KSP-${token}`, commissionPerPcs: 10_000 });
    itemId = item.id;
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).commissionPerPcs)).toBe(10_000);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...gamis(), nameId: "Gamis uji 2" }, { olehUserId: userId }));
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).commissionPerPcs)).toBe(10_000);
    // Tanpa perubahan komisi: tidak ada jejak komisi.
    expect(await prisma.auditLog.count({ where: { entityId: itemId, action: "ITEM_SPG_COMMISSION_CHANGED" } })).toBe(0);

    const klien = await getItemById(itemId);
    expect(klien?.commissionPerPcs).toBe(10_000);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...gamis(), commissionPerPcs: 12_500 }, { olehUserId: userId }));
    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...gamis(), commissionPerPcs: null }, { olehUserId: userId }));
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).commissionPerPcs)).toBe(0);

    const jejak = await prisma.auditLog.findMany({
      where: { entityId: itemId, action: "ITEM_SPG_COMMISSION_CHANGED" },
      orderBy: { createdAt: "asc" },
      select: { userId: true, entityType: true, changes: true },
    });
    expect(jejak).toHaveLength(2);
    expect(jejak[0]).toMatchObject({ userId, entityType: "Item", changes: { before: { commissionPerPcs: 10_000 }, after: { commissionPerPcs: 12_500 } } });
    expect(jejak[1]).toMatchObject({ changes: { before: { commissionPerPcs: 12_500 }, after: { commissionPerPcs: 0 } } });
  });

  it("menolak negatif, dan komisi di barang yang bukan barang jadi", async () => {
    await expect(prisma.$transaction((tx) => updateItem(tx, itemId, { ...gamis(), commissionPerPcs: -5 }))).rejects.toThrow(/commissionPerPcs/);
    await expect(createItem({ nameId: "Kain uji", nameEn: "Fabric", type: "FABRIC", uomId, sku: `TEST-KSP-K-${token}`, commissionPerPcs: 1_000 })).rejects.toThrow(
      /commissionPerPcs/,
    );
    const { item } = await createItem({ nameId: "Kain uji", nameEn: "Fabric", type: "FABRIC", uomId, sku: `TEST-KSP-K-${token}`, commissionPerPcs: 0 });
    kainId = item.id;
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: kainId } })).commissionPerPcs)).toBe(0);
  });
});
