import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { seededId } from "./spec-teardown";
import { appendSeedOpeningBalances, hasMainLedgerEntry } from "../prisma/seed-ledger";

// Writes ledger rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("appendSeedOpeningBalances (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  let rowId = "";
  let zeroItemId = "";
  let zeroRowId = "";
  let tag = "";

  beforeEach(async () => {
    tag = Math.random().toString(36).slice(2, 10);
    itemId = "";
    uomId = "";
    rowId = "";
    zeroItemId = "";
    zeroRowId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${tag}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-SEEDLEDGER-${tag}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const row = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, reservedQty: 0, avgCost: 1000, totalValue: 12000 },
    });
    rowId = row.id;

    const zeroItem = await prisma.item.create({
      data: { sku: `TEST-SEEDLEDGER-ZERO-${tag}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    zeroItemId = zeroItem.id;
    const zeroRow = await prisma.inventoryValue.create({
      data: { itemId: zeroItemId, variantSku: null, qtyOnHand: 0, reservedQty: 0, avgCost: 0, totalValue: 0 },
    });
    zeroRowId = zeroRow.id;
  });

  afterEach(async () => {
    for (const id of [itemId, zeroItemId]) {
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.item.deleteMany({ where: { id: seededId(id) } });
    }
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("appends one OPENING entry in the cutover spelling, and is idempotent", async () => {
    const first = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, [rowId]));
    expect(first).toBe(1);

    const entries = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "OPENING",
      refType: "OpeningBalance",
      refId: rowId,
      refDocNumber: "",
      locationType: "MAIN",
      locationId: "",
      variantSku: "",
    });
    expect(Number(entries[0].qty)).toBe(12);
    expect(Number(entries[0].balanceQty)).toBe(12);
    expect(entries[0].totalCost).toBeNull();
    expect(entries[0].balanceValue).toBeNull();

    const second = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, [rowId]));
    expect(second).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(1);
  });

  it("appends nothing for a zero-quantity row", async () => {
    const appended = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, [zeroRowId]));
    expect(appended).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: zeroItemId } })).toBe(0);
  });

  it("appends nothing when the key already holds a non-OPENING ledger entry", async () => {
    await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "",
        type: "IN",
        qty: 12,
        balanceQty: 12,
        refType: "GRN",
        refId: "spec-ref",
        refDocNumber: "",
      },
    });
    const appended = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, [rowId]));
    expect(appended).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId, type: "OPENING" } })).toBe(0);
  });

  it("hasMainLedgerEntry reports any MAIN entry on the normalised key, not only an OPENING one", async () => {
    expect(await hasMainLedgerEntry(prisma, itemId, null)).toBe(false);
    await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "",
        type: "IN",
        qty: 12,
        balanceQty: 12,
        refType: "GRN",
        refId: "spec-ref",
        refDocNumber: "",
      },
    });
    expect(await hasMainLedgerEntry(prisma, itemId, null)).toBe(true);
    expect(await hasMainLedgerEntry(prisma, itemId, "")).toBe(true);
    expect(await hasMainLedgerEntry(prisma, zeroItemId, null)).toBe(false);
  });

  it("folds a null row and a \"\" row of one item into one OPENING entry at the summed quantity", async () => {
    const emptyRow = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 8, reservedQty: 0, avgCost: 1000, totalValue: 8000 },
    });
    const appended = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, [rowId, emptyRow.id]));
    expect(appended).toBe(1);
    const entries = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("OPENING");
    expect(entries[0].variantSku).toBe("");
    expect(Number(entries[0].qty)).toBe(20);
    expect(Number(entries[0].balanceQty)).toBe(20);
  });

  it("appends nothing for an empty id list, even with non-zero rows present", async () => {
    const appended = await prisma.$transaction((tx) => appendSeedOpeningBalances(tx, []));
    expect(appended).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
  });
});
