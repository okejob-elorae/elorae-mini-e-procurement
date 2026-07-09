import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { loadVan } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("loadVan (test bed only)", () => {
  const tag = `VAN-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let canvasserId = "";
  let adminId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 10, avgCost: 1000, totalValue: 100000 } });
    const canv = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    canvasserId = canv.id;
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.vanLoadLine.deleteMany({ where: { itemId } });
    await prisma.vanLoad.deleteMany({ where: { canvasserId } });
    await prisma.vanStock.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  const line = (qty: number) => ({ itemId, variantSku: null, qty });

  it("loads stock: main down, van up, adjustment + load doc written", async () => {
    const res = await loadVan({ canvasserId, loadedById: adminId, lines: [line(20)] });
    expect(res.ok).toBe(true);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(inv!.qtyOnHand.toNumber()).toBe(80);                 // 100 - 20
    expect(inv!.totalValue.toNumber()).toBe(80000);             // 80 * 1000
    const van = await prisma.vanStock.findFirst({ where: { userId: canvasserId, itemId } });
    expect(van!.qty.toNumber()).toBe(20);
    expect(van!.avgCost.toNumber()).toBe(1000);
    const adj = await prisma.stockAdjustment.findFirst({ where: { itemId, source: "VAN_LOAD" } });
    expect(adj!.type).toBe("NEGATIVE");
    expect(adj!.qtyChange.toNumber()).toBe(-20);
    const load = await prisma.vanLoad.findFirst({ where: { canvasserId }, include: { lines: true } });
    expect(load!.lines).toHaveLength(1);
  });

  it("rejects when qty exceeds available (qtyOnHand - reservedQty)", async () => {
    // available = 100 - 10 = 90
    const res = await loadVan({ canvasserId, loadedById: adminId, lines: [line(91)] });
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "INSUFFICIENT_STOCK") {
      expect(res.shortLines[0]).toMatchObject({ requested: 91, available: 90 });
    } else { throw new Error("expected INSUFFICIENT_STOCK"); }
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(inv!.qtyOnHand.toNumber()).toBe(100);               // untouched
  });

  it("sums duplicate lines and accumulates across loads with weighted avg", async () => {
    await loadVan({ canvasserId, loadedById: adminId, lines: [line(10), line(10)] }); // 20 @ 1000
    // change main avgCost, load again
    await prisma.inventoryValue.update({ where: { itemId_variantSku: { itemId, variantSku: "" } }, data: { avgCost: 2000 } });
    await loadVan({ canvasserId, loadedById: adminId, lines: [line(20)] });           // +20 @ 2000
    const van = await prisma.vanStock.findFirst({ where: { userId: canvasserId, itemId } });
    expect(van!.qty.toNumber()).toBe(40);
    expect(van!.avgCost.toNumber()).toBe(1500);                // (20*1000 + 20*2000)/40
  });

  it("returns EMPTY when no positive-qty lines", async () => {
    const res = await loadVan({ canvasserId, loadedById: adminId, lines: [line(0)] });
    expect(res).toEqual({ ok: false, code: "EMPTY" });
  });
});
