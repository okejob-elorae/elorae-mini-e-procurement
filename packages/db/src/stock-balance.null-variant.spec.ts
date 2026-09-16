import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { moveMainStock } from "./stock-balance";
import { seededId } from "./spec-teardown";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Pins the read/write row-identity guarantee moveMainStock's `inventoryValueId` parameter exists
 * for (Task 8 fix rounds 2-3): an item can legitimately carry BOTH a variantSku: null row and a
 * variantSku: "" row for the same itemId (a Jubelio-vs-ERP-creation fork). The row an OR-tolerant
 * read resolves must be the exact row the write lands on, and the sibling row must be untouched.
 */
d("moveMainStock resolves one row of a null/\"\" pair (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  let nullRowId = "";
  let emptyRowId = "";
  const sku = `TEST-DUALROW-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";
    nullRowId = "";
    emptyRowId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    const nullRow = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 },
    });
    nullRowId = nullRow.id;

    const emptyRow = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 30, reservedQty: 0, avgCost: 2000, totalValue: 60000 },
    });
    emptyRowId = emptyRow.id;
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("the row an OR-tolerant read resolves is the exact row moveMainStock writes to, leaving the sibling untouched", async () => {
    // Mirrors costing.ts's findExistingInventoryValueRow exactly: falsy sku matches null OR "",
    // orderBy id asc as the deterministic tie-break. A caller (costing.ts) does this same read
    // independently and passes the resolved id through as inventoryValueId.
    const resolved = await prisma.inventoryValue.findFirst({
      where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      orderBy: { id: "asc" },
    });
    expect(resolved).not.toBeNull();

    const priorQty = Number(resolved!.qtyOnHand);
    // Computed from THIS row's own prior state (1200), not the sibling's (which would be a
    // different number for whichever row was NOT resolved).
    const newAvgCost = 1200;
    const newTotalValue = (priorQty + 10) * newAvgCost;

    await prisma.$transaction(async (tx) => {
      await moveMainStock(tx, {
        itemId,
        variantSku: resolved!.variantSku,
        qtyDelta: 10,
        avgCost: newAvgCost,
        totalValue: newTotalValue,
        inventoryValueId: resolved!.id,
        refType: "TEST",
        refId: "dual-row-receipt",
      });
    });

    const movedRow = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: resolved!.id } });
    expect(Number(movedRow.qtyOnHand)).toBe(priorQty + 10);
    expect(Number(movedRow.avgCost)).toBe(newAvgCost);

    const untouchedId = resolved!.id === nullRowId ? emptyRowId : nullRowId;
    const untouchedExpected = untouchedId === nullRowId
      ? { qty: 50, avgCost: 1000 }
      : { qty: 30, avgCost: 2000 };
    const untouchedRow = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: untouchedId } });
    // The sibling reflects its own original state, not the resolved row's new avgCost — proof
    // the write did not land on (or otherwise disturb) the other row in the same null/"" bucket.
    expect(Number(untouchedRow.qtyOnHand)).toBe(untouchedExpected.qty);
    expect(Number(untouchedRow.avgCost)).toBe(untouchedExpected.avgCost);
  });
});
