import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { MainStockNegativeError, moveMainStock } from "./stock-balance";
import { seededId } from "./spec-teardown";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Pins the atomic floor on main stock. Callers pre-read the row, check the figure, then issue an
 * atomic decrement, so the check and the write see different states under concurrency — the floor
 * has to live in the UPDATE's own where clause or it is advisory only. Store and van balances are
 * deliberately NOT guarded (a stocktake corrects a store); main has no such correction path.
 */
d("moveMainStock refuses to drive a main balance negative (test bed only)", () => {
  let itemId = "";
  let otherItemId = "";
  let uomId = "";
  let rowId = "";
  const sku = `TEST-FLOOR-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run created. */
    itemId = "";
    otherItemId = "";
    uomId = "";
    rowId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    /* A second item with no balance row of its own — the wrong-item ownership case below. */
    const otherItem = await prisma.item.create({
      data: {
        sku: `${sku}-OTHER`,
        nameId: "test",
        nameEn: "test",
        type: "FINISHED_GOOD",
        isActive: true,
        uomId,
      },
    });
    otherItemId = otherItem.id;

    const row = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 5, reservedQty: 0, avgCost: 1000, totalValue: 5000 },
    });
    rowId = row.id;
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({
      where: { itemId: { in: [seededId(itemId), seededId(otherItemId)] } },
    });
    await prisma.inventoryValue.deleteMany({
      where: { itemId: { in: [seededId(itemId), seededId(otherItemId)] } },
    });
    await prisma.item.deleteMany({
      where: { id: { in: [seededId(itemId), seededId(otherItemId)] } },
    });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("throws on the pinned path and leaves the balance and the ledger untouched", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await moveMainStock(tx, {
          itemId,
          variantSku: "",
          qtyDelta: -6,
          inventoryValueId: rowId,
          refType: "TEST",
          refId: "floor-pinned",
        });
      }),
    ).rejects.toBeInstanceOf(MainStockNegativeError);

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(5);

    const entries = await prisma.stockLedgerEntry.count({ where: { itemId } });
    expect(entries).toBe(0);
  });

  it("throws on the resolved-lookup path too", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await moveMainStock(tx, {
          itemId,
          variantSku: null,
          qtyDelta: -6,
          refType: "TEST",
          refId: "floor-resolved",
        });
      }),
    ).rejects.toBeInstanceOf(MainStockNegativeError);

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(5);
  });

  /*
   * The ownership rail and the floor now share one `count !== 1` miss on the pinned path, so the
   * only thing separating them is the diagnosing re-read below it. The delta here is well within
   * the balance — the floor filter passes on its own — which means a regression that folds the two
   * arms together reports a caller bug as a live stock shortage, and ops goes looking for units
   * that were never missing.
   */
  it("reports a wrong-item inventoryValueId as an ownership failure, not a negative balance", async () => {
    let caught: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        await moveMainStock(tx, {
          itemId: otherItemId,
          variantSku: "",
          qtyDelta: -1,
          inventoryValueId: rowId,
          refType: "TEST",
          refId: "floor-wrong-item",
        });
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(MainStockNegativeError);
    expect((caught as Error).message).toContain("does not belong to item");

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(5);

    const entries = await prisma.stockLedgerEntry.count({
      where: { itemId: { in: [itemId, otherItemId] } },
    });
    expect(entries).toBe(0);
  });

  it("allows a decrement that lands exactly on zero", async () => {
    await prisma.$transaction(async (tx) => {
      await moveMainStock(tx, {
        itemId,
        variantSku: "",
        qtyDelta: -5,
        inventoryValueId: rowId,
        refType: "TEST",
        refId: "floor-exact",
      });
    });

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(0);
  });
});
