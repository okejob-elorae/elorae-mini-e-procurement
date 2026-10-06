import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { ConcurrentFirstReceiptError, moveMainStock } from "./stock-balance";
import { seededId } from "./spec-teardown";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Pins the first-receipt serialisation. The variantless row is created spelled null and the unique
 * index does not compare NULLs, so only the lock on the Item row stops two racing first receipts
 * from each inserting one.
 */
d("moveMainStock createIfMissing serialises first receipts (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const sku = `TEST-CIM-${Math.random().toString(36).slice(2, 10)}`;

  const receive = (refId: string, qtyDelta: number) =>
    prisma.$transaction((tx) =>
      moveMainStock(tx, {
        itemId,
        variantSku: "",
        qtyDelta,
        refType: "GRN",
        refId,
        createIfMissing: true,
      }),
    );

  beforeEach(async () => {
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
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function expectOneRowAt8() {
    const rows = await prisma.inventoryValue.findMany({ where: { itemId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qtyOnHand)).toBe(8);
    expect(rows[0].variantSku).toBeNull();
  }

  it("sequential first receipts land on one null-spelled row", async () => {
    await receive("t1", 5);
    await receive("t2", 3);
    await expectOneRowAt8();
  });

  it("concurrent first receipts land on one null-spelled row", async () => {
    await Promise.all([receive("t1", 5), receive("t2", 3)]);
    await expectOneRowAt8();
  });

  /**
   * Both receipts must miss on their first lookup, or the loser simply finds the row and this pins
   * nothing. Each transaction therefore fixes its REPEATABLE READ snapshot with a plain read and
   * waits for the other to do the same before moving stock, so both lookups see no row whichever
   * one commits first.
   */
  it("refuses caller-computed costs on a row only the locking re-read found", async () => {
    let arrived = 0;
    let release: () => void = () => {};
    const bothSnapshotted = new Promise<void>((resolve) => {
      release = resolve;
    });

    const receiveCosted = (refId: string, qtyDelta: number, avgCost: number) =>
      prisma.$transaction(async (tx) => {
        await tx.inventoryValue.findFirst({ where: { itemId } });
        arrived += 1;
        if (arrived === 2) release();
        await bothSnapshotted;
        return moveMainStock(tx, {
          itemId,
          variantSku: "",
          qtyDelta,
          avgCost,
          totalValue: qtyDelta * avgCost,
          totalCost: qtyDelta * avgCost,
          balanceValue: qtyDelta * avgCost,
          refType: "GRN",
          refId,
          createIfMissing: true,
        });
      });

    const receipts = [
      { refId: "c1", qty: 5, avgCost: 10 },
      { refId: "c2", qty: 3, avgCost: 20 },
    ];
    const results = await Promise.allSettled(
      receipts.map((r) => receiveCosted(r.refId, r.qty, r.avgCost)),
    );

    const committed = results.flatMap((r, i) => (r.status === "fulfilled" ? [receipts[i]] : []));
    const refused = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    expect(committed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(ConcurrentFirstReceiptError);

    const winner = committed[0];
    const rows = await prisma.inventoryValue.findMany({ where: { itemId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].variantSku).toBeNull();
    expect(Number(rows[0].qtyOnHand)).toBe(winner.qty);
    expect(Number(rows[0].avgCost)).toBe(winner.avgCost);
    expect(Number(rows[0].totalValue)).toBe(winner.qty * winner.avgCost);

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(ledger.map((e) => e.refId)).toEqual([winner.refId]);
  });
});
