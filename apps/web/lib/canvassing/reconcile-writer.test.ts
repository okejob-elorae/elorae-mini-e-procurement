import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { recordVanReconcile } from "./reconcile-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordVanReconcile (test bed only)", () => {
  const tag = `VRCN-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let canvasserId = ""; let adminId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 } });
    itemId = item.id;
    // main starts at 50 @ 1000 (after some was loaded to the van). Variantless main rows use
    // variantSku: null in this codebase (production shape) — the return path must find it.
    await prisma.inventoryValue.create({ data: { itemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 } });
    // Dedicated canvasser — recordVanReconcile reads ALL of a user's van rows, so it must NOT
    // share salesman@elorae.com with the parallel 8a/8b suites (they'd leave foreign van rows).
    const canv = await prisma.user.create({ data: { email: `canvasser-${tag}@test.local`, name: "Reconcile Canvasser" } });
    canvasserId = canv.id;
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    adminId = admin.id;
    // van holds 10 @ 1000 (expected remaining)
    await prisma.vanStock.create({ data: { userId: canvasserId, itemId, variantSku: "", qty: 10, avgCost: 1000 } });
  });

  afterEach(async () => {
    await prisma.vanReconcileLine.deleteMany({ where: { itemId } });
    await prisma.vanReconcile.deleteMany({ where: { canvasserId } });
    await prisma.vanStock.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
    await prisma.user.deleteMany({ where: { id: canvasserId } });
  });

  const count = (qty: number) => [{ itemId, variantSku: null, qty }].map(() => ({ itemId, variantSku: null as string | null, countedQty: qty }));

  it("exact match: returns counted to main, empties van, variance 0, VAN_RETURN adjustment", async () => {
    const res = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: count(10) });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.totalVarianceQty).toBe(0);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(60); // 50 + 10 returned
    const van = await prisma.vanStock.findFirst({ where: { userId: canvasserId, itemId } });
    expect(Number(van!.qty)).toBe(0); // emptied
    const adj = await prisma.stockAdjustment.findFirst({ where: { itemId, source: "VAN_RETURN" } });
    expect(adj!.type).toBe("POSITIVE");
    expect(Number(adj!.qtyChange)).toBe(10);
  });

  it("shortage without note → VARIANCE_NEEDS_REASON; with note → returns only counted, logs variance", async () => {
    const bad = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: count(7) }); // 3 short, no note
    expect(bad).toEqual({ ok: false, code: "VARIANCE_NEEDS_REASON" });
    const ok = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: count(7), note: "3 hilang di jalan" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.totalVarianceQty).toBe(3); // expected 10 - counted 7
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(57); // 50 + 7 only (shortfall not re-added)
    const van = await prisma.vanStock.findFirst({ where: { userId: canvasserId, itemId } });
    expect(Number(van!.qty)).toBe(0);
  });

  it("surplus (counted > expected) with note → returns full counted, negative variance", async () => {
    const res = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: count(12), note: "found 2 extra" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.totalVarianceQty).toBe(-2);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(62); // 50 + 12
  });

  it("empty van → EMPTY_VAN", async () => {
    await prisma.vanStock.updateMany({ where: { userId: canvasserId, itemId }, data: { qty: 0 } });
    const res = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: count(0) });
    expect(res).toEqual({ ok: false, code: "EMPTY_VAN" });
  });

  it("count list missing the van row → COUNT_MISMATCH", async () => {
    const res = await recordVanReconcile({ canvasserId, reconciledById: adminId, counts: [] });
    expect(res).toEqual({ ok: false, code: "COUNT_MISMATCH" });
  });

  it("stamps the variant label into VanReconcileLine.productName", async () => {
    const vUom = await prisma.uOM.create({ data: { code: `UVR-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    const vItem = await prisma.item.create({
      data: {
        sku: `${tag}-V`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId: vUom.id, isActive: true, sellingPrice: 5000,
        variants: [{ sku: `${tag}-V-M`, size: "M" }],
      },
    });
    await prisma.inventoryValue.create({ data: { itemId: vItem.id, variantSku: `${tag}-V-M`, qtyOnHand: 0, reservedQty: 0, avgCost: 1000, totalValue: 0 } });
    // isolate to a fresh canvasser so the shared van seed isn't in this reconcile's row set
    const vCanv = await prisma.user.create({ data: { email: `rc-${tag}@test.local`, name: "RC" } });
    await prisma.vanStock.create({ data: { userId: vCanv.id, itemId: vItem.id, variantSku: `${tag}-V-M`, qty: 6, avgCost: 1000 } });

    const res = await recordVanReconcile({ canvasserId: vCanv.id, reconciledById: adminId, counts: [{ itemId: vItem.id, variantSku: `${tag}-V-M`, countedQty: 6 }] });
    expect(res.ok).toBe(true);
    const rec = await prisma.vanReconcile.findFirst({ where: { canvasserId: vCanv.id }, include: { lines: true } });
    expect(rec!.lines[0].productName).toBe("Kaos — size: M");

    await prisma.vanReconcileLine.deleteMany({ where: { itemId: vItem.id } });
    await prisma.vanReconcile.deleteMany({ where: { canvasserId: vCanv.id } });
    await prisma.vanStock.deleteMany({ where: { itemId: vItem.id } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: vItem.id } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: vItem.id } });
    await prisma.item.deleteMany({ where: { id: vItem.id } });
    await prisma.uOM.deleteMany({ where: { id: vUom.id } });
    await prisma.user.deleteMany({ where: { id: vCanv.id } });
  });
});
