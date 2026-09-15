import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Decimal } from "decimal.js";
import { prisma, seededId } from "@elorae/db";
import { calculateMovingAverage } from "./costing";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Pins the exact regression Task 8's fix rounds exist to close: apps/web/lib/items/mutations.ts
 * creates every ERP item's InventoryValue row with variantSku: null. Before the fix,
 * calculateMovingAverage's strict findUnique (normalised to "") missed that row on every read
 * after the first, treated previousQty/previousAvgCost as 0, and moveMainStock's own OR-tolerant
 * write then SET the real row's avgCost from that false-zero baseline instead of composing it.
 */
d("calculateMovingAverage null-row identity (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const sku = `TEST-CMA-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    // No InventoryValue row seeded here — the first receipt below creates it via
    // calculateMovingAverage's createIfMissing, landing on variantSku: null the same way
    // moveMainStock's create branch does for a falsy sku.
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("a second receipt against a null-spelled row composes the moving average instead of resetting it from a false zero", async () => {
    await prisma.$transaction(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(100), new Decimal(10), tx, null, {
        refType: "TEST",
        refId: "receipt-1",
      });
    });

    const afterFirst = await prisma.inventoryValue.findFirst({
      where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
    });
    expect(afterFirst).not.toBeNull();
    expect(afterFirst!.variantSku).toBeNull();
    expect(Number(afterFirst!.qtyOnHand)).toBe(100);
    expect(Number(afterFirst!.avgCost)).toBe(10);

    await prisma.$transaction(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(100), new Decimal(20), tx, null, {
        refType: "TEST",
        refId: "receipt-2",
      });
    });

    // Still exactly one row — the second receipt did not fork a "" sibling alongside the null one.
    const rowCount = await prisma.inventoryValue.count({ where: { itemId } });
    expect(rowCount).toBe(1);

    const afterSecond = await prisma.inventoryValue.findFirst({
      where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
    });
    expect(afterSecond).not.toBeNull();
    expect(Number(afterSecond!.qtyOnHand)).toBe(200);
    // The regression: before the fix, the second receipt's read missed the null row, treated
    // previousQty/previousAvgCost as 0, and SET avgCost to 20 (totalValue to 2000) instead of
    // composing the two receipts to 15 (totalValue 3000).
    expect(Number(afterSecond!.avgCost)).toBe(15);
    expect(Number(afterSecond!.totalValue)).toBe(3000);
  });

  it("a GRN-shaped payload naming the same itemId twice (sequential lines) produces one row with a composed average", async () => {
    await prisma.$transaction(async (tx) => {
      // Mirrors grn.ts's Pass 2 after fix round 2's Finding 4: a sequential for-loop over GRN
      // lines, not Promise.all — two lines for the same never-before-stocked itemId in one
      // payload must not each independently see "no row" and fork a duplicate.
      await calculateMovingAverage(itemId, new Decimal(50), new Decimal(8), tx, null, {
        refType: "GRN",
        refId: "grn-shaped-1",
      });
      await calculateMovingAverage(itemId, new Decimal(30), new Decimal(12), tx, null, {
        refType: "GRN",
        refId: "grn-shaped-1",
      });
    });

    const rows = await prisma.inventoryValue.findMany({ where: { itemId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qtyOnHand)).toBe(80);
    // (50*8 + 30*12) / 80 = 9.5 — composed across both lines, not just the last one.
    expect(Number(rows[0].avgCost)).toBe(9.5);
  });
});
