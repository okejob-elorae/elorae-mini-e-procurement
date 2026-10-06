import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { moveMainStock } from "./stock-balance";
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
});
