import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { applyFgAccessoriesAdjustments, detectItemDrift } from "./opname-approve";
import { freezeItemSnapshot } from "./opname-snapshot";

/*
 * Barang buatan ERP bisa punya DUA baris InventoryValue tanpa varian: satu
 * `variantSku = null`, satu `""`. Snapshot opname dulu membuat dua baris hitung
 * untuk barang yang sama, sementara persetujuan menulis ke SATU baris stok →
 * stok berlipat atau kosong. Sekarang: satu baris hitung per (barang, varian)
 * dengan jumlah kedua baris stok, dan persetujuan menyisakan jumlah hitungan di
 * baris yang dipakai penulis lain, tanpa baris kembar yang ikut membengkak.
 *
 * Basis data uji saja; teardown lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("opname gudang: baris stok ganda null/\"\" (test bed only)", () => {
  let tag = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let opnameId = "";

  beforeEach(async () => {
    tag = Math.random().toString(36).slice(2, 9);
    userId = "";
    uomId = "";
    itemId = "";
    opnameId = "";
    userId = (await prisma.user.create({ data: { email: `opn-ganda-${tag}@test.local`, name: "Uji Opname Ganda" } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-OG-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `OG-${tag}`, nameId: `Kaos Ganda ${tag}`, nameEn: "Twin row tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
    opnameId = (
      await prisma.stockOpname.create({
        data: { docNumber: `OPN-OG-${tag}`, scope: "FINISHED_GOOD", status: "CREATED", snapshotAt: new Date(), createdById: userId },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { refType: "OPNAME", refId: seededId(opnameId) } });
    await prisma.stockAdjustment.deleteMany({ where: { externalRef: seededId(opnameId) } });
    await prisma.stockOpnameItem.deleteMany({ where: { opnameId: seededId(opnameId) } });
    await prisma.stockOpname.deleteMany({ where: { id: seededId(opnameId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** Dua baris stok kembar: null 3 potong, "" 4 potong. */
  async function barisKembar(hargaNull = 20_000, hargaKosong = 20_000) {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 3, reservedQty: 0, avgCost: hargaNull, totalValue: 3 * hargaNull },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 4, reservedQty: 0, avgCost: hargaKosong, totalValue: 4 * hargaKosong },
    });
  }

  const stok = async () => {
    const rows = await prisma.inventoryValue.findMany({ where: { itemId }, select: { qtyOnHand: true, totalValue: true } });
    return {
      qty: rows.reduce((s, r) => s + Number(r.qtyOnHand), 0),
      nilai: rows.reduce((s, r) => s + Number(r.totalValue), 0),
      barisBerisi: rows.filter((r) => Number(r.qtyOnHand) !== 0).length,
    };
  };

  const hitungSemua = (qty: number) =>
    prisma.stockOpnameItem.updateMany({ where: { opnameId: seededId(opnameId), itemId: seededId(itemId) }, data: { countedQty: qty } });
  const setujui = () => prisma.$transaction((tx) => applyFgAccessoriesAdjustments(tx, opnameId, `OPN-OG-${tag}`, userId, "FINISHED_GOOD"));

  it("snapshot makes ONE counting row per item with both stock rows added up (3 + 4 = 7)", async () => {
    await barisKembar();
    await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", [itemId]));
    const rows = await prisma.stockOpnameItem.findMany({ where: { opnameId }, select: { itemId: true, variantSku: true, snapshotQty: true } });
    expect(rows.map((r) => ({ ...r, snapshotQty: Number(r.snapshotQty) }))).toEqual([{ itemId, variantSku: null, snapshotQty: 7 }]);
  });

  it("3 + 4 counted 7 → stock stays 7 (not 14, not 0), no drift, no adjustment", async () => {
    await barisKembar();
    await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", [itemId]));
    await hitungSemua(7);
    expect(await prisma.$transaction((tx) => detectItemDrift(tx, opnameId))).toEqual([]);
    const r = await setujui();
    expect(r.adjustmentCount).toBe(0);
    expect(await stok()).toMatchObject({ qty: 7, nilai: 140_000 });
  });

  it("3 + 4 counted 5 → 5 left in one row, the twin emptied; adjustment 7 → 5 worth −Rp40.000", async () => {
    await barisKembar();
    await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", [itemId]));
    await hitungSemua(5);
    const r = await setujui();
    expect(r.adjustmentCount).toBe(1);
    expect(await stok()).toEqual({ qty: 5, nilai: 100_000, barisBerisi: 1 });

    const adj = await prisma.stockAdjustment.findMany({ where: { externalRef: opnameId }, select: { type: true, prevQty: true, newQty: true, qtyChange: true } });
    expect(adj.map((a) => ({ type: a.type, prevQty: Number(a.prevQty), newQty: Number(a.newQty), qtyChange: Number(a.qtyChange) }))).toEqual([
      { type: "NEGATIVE", prevQty: 7, newQty: 5, qtyChange: 2 },
    ]);
    const mv = await prisma.stockMovement.findMany({ where: { refType: "OPNAME", refId: opnameId }, select: { qty: true, totalCost: true } });
    expect(mv.map((m) => ({ qty: Number(m.qty), totalCost: Number(m.totalCost) }))).toEqual([{ qty: -2, totalCost: -40_000 }]);
  });

  it("twin rows at different costs merge at the blended cost: 3 @20.000 + 4 @27.000 counted 5 → Rp120.000", async () => {
    await barisKembar(20_000, 27_000);
    await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", [itemId]));
    await hitungSemua(5);
    await setujui();
    // Nilai 168.000 untuk 7 potong = 24.000 per potong; 5 potong = 120.000.
    expect(await stok()).toEqual({ qty: 5, nilai: 120_000, barisBerisi: 1 });
    const mv = await prisma.stockMovement.findFirst({ where: { refType: "OPNAME", refId: opnameId }, select: { qty: true, totalCost: true } });
    expect({ qty: Number(mv?.qty), totalCost: Number(mv?.totalCost) }).toEqual({ qty: -2, totalCost: -48_000 });
  });

  it("an opname frozen before the fix (two rows 3 and 4 for one item) counted 3 and 4 → stock 7, not 8", async () => {
    await barisKembar();
    await prisma.stockOpnameItem.createMany({
      data: [
        { opnameId, itemId, variantSku: null, itemName: "Kaos", snapshotQty: 3, countedQty: 3 },
        { opnameId, itemId, variantSku: null, itemName: "Kaos", snapshotQty: 4, countedQty: 4 },
      ],
    });
    expect(await prisma.$transaction((tx) => detectItemDrift(tx, opnameId))).toEqual([]);
    const r = await setujui();
    expect(r.adjustmentCount).toBe(0);
    expect((await stok()).qty).toBe(7);
  });

  it("applying twice never adjusts twice", async () => {
    await barisKembar();
    await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", [itemId]));
    await hitungSemua(5);
    await setujui();
    await setujui();
    expect((await stok()).qty).toBe(5);
    expect(await prisma.stockAdjustment.count({ where: { externalRef: opnameId } })).toBe(1);
  });
});
