import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { findSupersededItems, retireSupersededItem } from "./superseded-items";
import { seededId } from "./spec-teardown";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("superseded item retirement (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const itemIds: string[] = [];
  let uomId = "";
  /* Well above any real Jubelio id, so a fixture mapping never collides with a synced one. */
  let nextJubelioId = Math.floor(Math.random() * 1_000_000) + 910_000_000;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run created. */
    uomId = "";
    itemIds.length = 0;
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-SUP-${token}-${nextJubelioId}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
  });

  afterEach(async () => {
    for (const itemId of itemIds) {
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    }
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function seedItem(label: string, rows: Array<{ variantSku: string; qty: number }>, mapped: boolean) {
    const item = await prisma.item.create({
      data: { sku: `TEST-SUP-${token}-${label}`, nameId: label, nameEn: label, type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemIds.push(item.id);
    for (const row of rows) {
      await prisma.inventoryValue.create({
        data: { itemId: item.id, variantSku: row.variantSku, qtyOnHand: row.qty, avgCost: 10, totalValue: row.qty * 10 },
      });
      if (mapped) {
        const jubelioItemId = nextJubelioId++;
        await prisma.jubelioProductMapping.create({
          data: {
            itemId: item.id,
            jubelioItemGroupId: nextJubelioId++,
            jubelioItemId,
            jubelioItemCode: `TEST-SUP-CODE-${token}-${jubelioItemId}`,
            erpVariantSku: row.variantSku,
          },
        });
      }
    }
    return item.id;
  }

  function variant(suffix: string): string {
    return `TEST-SUP-${token}-${suffix}`;
  }

  it("qualifies an unmapped item whose every variant lives on a mapped twin, and retires it", async () => {
    const twin = await seedItem("twin", [{ variantSku: variant("M"), qty: 40 }, { variantSku: variant("L"), qty: 25 }], true);
    const stale = await seedItem("stale", [
      { variantSku: variant("M"), qty: -7 },
      { variantSku: variant("L"), qty: 12 },
    ], false);

    const found = await findSupersededItems(prisma, { itemIds: [stale, twin] });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ itemId: stale, qualified: true, rows: 2, nonZeroRows: 2, onHand: 5 });
    expect(found[0].twinSkus).toEqual([`TEST-SUP-${token}-twin`]);

    const res = await retireSupersededItem(prisma, { itemId: stale, actorId: null });

    expect(res).toEqual({ retired: true, rowsZeroed: 2 });
    const rows = await prisma.inventoryValue.findMany({ where: { itemId: stale } });
    expect(rows.every((r) => Number(r.qtyOnHand) === 0 && Number(r.totalValue) === 0)).toBe(true);
    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: stale }, orderBy: { variantSku: "asc" } });
    expect(ledger.map((l) => [l.variantSku, Number(l.qty), Number(l.balanceQty), l.refType])).toEqual([
      [variant("L"), -12, 0, "StockAdjustment"],
      [variant("M"), 7, 0, "StockAdjustment"],
    ]);
    expect(await prisma.stockAdjustment.count({ where: { itemId: stale } })).toBe(2);
    const item = await prisma.item.findUnique({ where: { id: stale } });
    expect(item!.isActive).toBe(false);

    const twinRows = await prisma.inventoryValue.findMany({ where: { itemId: twin }, orderBy: { variantSku: "asc" } });
    expect(twinRows.map((r) => Number(r.qtyOnHand))).toEqual([25, 40]);
    const twinItem = await prisma.item.findUnique({ where: { id: twin } });
    expect(twinItem!.isActive).toBe(true);
  });

  it("writes no ledger entry for a row already at zero", async () => {
    await seedItem("twin", [{ variantSku: variant("M"), qty: 3 }, { variantSku: variant("S"), qty: 3 }], true);
    const stale = await seedItem("stale", [{ variantSku: variant("M"), qty: 0 }, { variantSku: variant("S"), qty: -2 }], false);

    const res = await retireSupersededItem(prisma, { itemId: stale, actorId: null });

    expect(res).toEqual({ retired: true, rowsZeroed: 1 });
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: stale } })).toBe(1);
  });

  it("is a no-op on replay", async () => {
    await seedItem("twin", [{ variantSku: variant("M"), qty: 3 }], true);
    const stale = await seedItem("stale", [{ variantSku: variant("M"), qty: -4 }], false);

    await retireSupersededItem(prisma, { itemId: stale, actorId: null });
    const again = await retireSupersededItem(prisma, { itemId: stale, actorId: null });

    expect(again).toEqual({ retired: true, rowsZeroed: 0 });
    expect(await prisma.stockAdjustment.count({ where: { itemId: stale } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: stale } })).toBe(1);
  });

  it("refuses VARIANT_NOT_SUPERSEDED when one variant lives on no mapped item, writing nothing", async () => {
    await seedItem("twin", [{ variantSku: variant("M"), qty: 3 }], true);
    const stale = await seedItem("stale", [{ variantSku: variant("M"), qty: -1 }, { variantSku: variant("XL"), qty: 9 }], false);

    const found = await findSupersededItems(prisma, { itemIds: [stale] });
    expect(found[0]).toMatchObject({ itemId: stale, qualified: false, reason: "VARIANT_NOT_SUPERSEDED" });

    const res = await retireSupersededItem(prisma, { itemId: stale, actorId: null });
    expect(res).toEqual({ retired: false, reason: "VARIANT_NOT_SUPERSEDED" });
    const rows = await prisma.inventoryValue.findMany({ where: { itemId: stale }, orderBy: { variantSku: "asc" } });
    expect(rows.map((r) => Number(r.qtyOnHand))).toEqual([-1, 9]);
    expect((await prisma.item.findUnique({ where: { id: stale } }))!.isActive).toBe(true);
  });

  it("refuses VARIANTLESS_ROW for an item holding a variantless stock row", async () => {
    await seedItem("twin", [{ variantSku: variant("M"), qty: 3 }], true);
    const stale = await seedItem("stale", [{ variantSku: variant("M"), qty: -1 }, { variantSku: "", qty: 2 }], false);

    const res = await retireSupersededItem(prisma, { itemId: stale, actorId: null });

    expect(res).toEqual({ retired: false, reason: "VARIANTLESS_ROW" });
  });

  it("refuses OPEN_RESERVATION while the item still holds a RESERVED reservation", async () => {
    await seedItem("twin", [{ variantSku: variant("M"), qty: 3 }], true);
    const stale = await seedItem("stale", [{ variantSku: variant("M"), qty: -1 }], false);
    await prisma.stockReservation.create({
      data: { itemId: stale, variantSku: variant("M"), qty: 1, state: "RESERVED", source: "JUBELIO" },
    });

    const res = await retireSupersededItem(prisma, { itemId: stale, actorId: null });

    expect(res).toEqual({ retired: false, reason: "OPEN_RESERVATION" });
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: stale } })).toBe(0);
  });

  it("refuses HAS_MAPPING for an item that is itself linked to Jubelio", async () => {
    const mapped = await seedItem("mapped", [{ variantSku: variant("M"), qty: -2 }], true);

    const found = await findSupersededItems(prisma, { itemIds: [mapped] });
    expect(found).toEqual([]);
    const res = await retireSupersededItem(prisma, { itemId: mapped, actorId: null });
    expect(res).toEqual({ retired: false, reason: "HAS_MAPPING" });
  });
});
