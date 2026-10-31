import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postGrnJournal, postGrnReversalJournal } from "./grn-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("GRN auto-journal (test bed only)", () => {
  let token: string;
  let userId = "";
  let supplierId = "";
  let grnId = "";
  let supplierTypeId = "";
  let inventoryId = "";
  let apId = "";
  let fgInventoryId = "";
  let uomId = "";
  let fgItemId = "";
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    grnId = "";
    inventoryId = "";
    apId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    fgInventoryId = "";
    uomId = "";
    fgItemId = "";
    mappingSnapshot = await snapshotMappings(["INVENTORY", "INVENTORY_FG", "AP"]);

    const user = await prisma.user.create({
      data: { email: `test-grn-journal-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({
      data: { code: `ST-${token}`, name: "Test Type" },
    });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}`,
        supplierId,
        receivedBy: userId,
        totalAmount: 500,
        items: [],
        grnDate: new Date("2026-01-15"),
      },
      select: { id: true },
    });
    grnId = grn.id;

    const inventory = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Persediaan (test)", type: "ASET", depth: 1, isActive: true },
    });
    inventoryId = inventory.id;
    const ap = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Hutang (test)", type: "LIABILITAS", depth: 1, isActive: true },
    });
    apId = ap.id;
    const fgInventory = await prisma.chartAccount.create({
      data: { code: `9${token}3`, name: "Persediaan barang jadi (test)", type: "ASET", depth: 1, isActive: true },
    });
    fgInventoryId = fgInventory.id;

    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY" }, create: { role: "INVENTORY", chartAccountId: inventoryId }, update: { chartAccountId: inventoryId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "AP" }, create: { role: "AP", chartAccountId: apId }, update: { chartAccountId: apId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY_FG" }, create: { role: "INVENTORY_FG", chartAccountId: fgInventoryId }, update: { chartAccountId: fgInventoryId },
    });
  });

  afterEach(async () => {
    const journals = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    const ids = journals.map((j) => j.id);
    if (ids.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: ids.map(seededId) } } });
      await prisma.journal.deleteMany({ where: { id: { in: ids.map(seededId) } } });
    }
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({ where: { id: { in: [inventoryId, apId, fgInventoryId].map(seededId).filter(Boolean) } } });
    if (fgItemId) await prisma.item.delete({ where: { id: seededId(fgItemId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.gRN.delete({ where: { id: grnId } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await prisma.supplierType.delete({ where: { id: supplierTypeId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("receipt posts DR Persediaan 500 / CR Hutang 500, balanced", async () => {
    const r = await postGrnJournal(grnId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN", sourceId: grnId } },
      include: { lines: true },
    });
    const inv = j!.lines.find((l) => l.chartAccountId === inventoryId);
    const ap = j!.lines.find((l) => l.chartAccountId === apId);
    expect(Number(inv!.debit)).toBe(500);
    expect(Number(ap!.credit)).toBe(500);
    expect(j!.date.toISOString()).toBe(new Date("2026-01-15").toISOString());
  });

  it("reversal posts DR Hutang 500 / CR Persediaan 500", async () => {
    expect(await postGrnJournal(grnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    const r = await postGrnReversalJournal(grnId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN_REVERSAL", sourceId: grnId } },
      include: { lines: true },
    });
    const inv = j!.lines.find((l) => l.chartAccountId === inventoryId);
    const ap = j!.lines.find((l) => l.chartAccountId === apId);
    expect(Number(ap!.debit)).toBe(500);
    expect(Number(inv!.credit)).toBe(500);
  });

  it("reversal with no receipt journal → NOTHING_TO_POST, posts nothing", async () => {
    const r = await postGrnReversalJournal(grnId, userId, prisma);
    expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN_REVERSAL", sourceId: grnId } },
    });
    expect(j).toBeNull();
  });

  it("zero totalAmount → NOTHING_TO_POST", async () => {
    await prisma.gRN.update({ where: { id: grnId }, data: { totalAmount: 0 } });
    const r = await postGrnJournal(grnId, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("unmapped AP → UNMAPPED_ROLE", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "AP" } });
    const r = await postGrnJournal(grnId, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "AP" });
  });

  it("is idempotent (re-post returns created:false)", async () => {
    const a = await postGrnJournal(grnId, userId, prisma);
    const b = await postGrnJournal(grnId, userId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
  });

  /*
   * Barang jadi yang dibeli jadi masuk persediaan BARANG JADI (INVENTORY_FG) — akun
   * yang dikredit HPP saat barang itu terjual. Dulu seluruh GRN mendebit INVENTORY,
   * sehingga penjualan barang itu membuat persediaan barang jadi negatif.
   */
  it("mixed receipt splits the debit by item type: fabric → INVENTORY, finished goods → INVENTORY_FG; reversal mirrors it", async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-GRNJ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const fg = await prisma.item.create({
      data: { sku: `GRNJ-FG-${token}`, nameId: "Barang jadi (test)", nameEn: "FG (test)", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    fgItemId = fg.id;
    // Baris kedua sengaja tanpa itemType (bentuk lama): tipenya dibaca dari Item.
    await prisma.gRN.update({
      where: { id: grnId },
      data: {
        totalAmount: 500,
        items: JSON.stringify([
          { itemId: "kain-test", itemType: "FABRIC", qty: 10, unitCost: 30, totalCost: 300 },
          { itemId: fgItemId, qty: 4, unitCost: 50, totalCost: 200 },
        ]),
      },
    });

    expect(await postGrnJournal(grnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "GRN", sourceId: grnId } }, include: { lines: true } });
    expect(j!.lines).toHaveLength(3);
    expect(Number(j!.lines.find((l) => l.chartAccountId === inventoryId)!.debit)).toBe(300);
    expect(Number(j!.lines.find((l) => l.chartAccountId === fgInventoryId)!.debit)).toBe(200);
    expect(Number(j!.lines.find((l) => l.chartAccountId === apId)!.credit)).toBe(500);

    expect(await postGrnReversalJournal(grnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    const r = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "GRN_REVERSAL", sourceId: grnId } }, include: { lines: true } });
    expect(Number(r!.lines.find((l) => l.chartAccountId === apId)!.debit)).toBe(500);
    expect(Number(r!.lines.find((l) => l.chartAccountId === inventoryId)!.credit)).toBe(300);
    expect(Number(r!.lines.find((l) => l.chartAccountId === fgInventoryId)!.credit)).toBe(200);
  });

  it("line values that do not add up to totalAmount: the payable is still exactly totalAmount", async () => {
    await prisma.gRN.update({
      where: { id: grnId },
      data: {
        totalAmount: 100.01,
        items: JSON.stringify([
          { itemId: "a", itemType: "FABRIC", totalCost: 33.333 },
          { itemId: "b", itemType: "FINISHED_GOOD", totalCost: 66.666 },
        ]),
      },
    });
    expect(await postGrnJournal(grnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "GRN", sourceId: grnId } }, include: { lines: true } });
    const debit = j!.lines.reduce((t, l) => t + Number(l.debit), 0);
    expect(Math.round(debit * 100)).toBe(10001);
    expect(Number(j!.lines.find((l) => l.chartAccountId === apId)!.credit)).toBe(100.01);
    expect(Number(j!.lines.find((l) => l.chartAccountId === fgInventoryId)!.debit)).toBe(66.68);
  });
});
