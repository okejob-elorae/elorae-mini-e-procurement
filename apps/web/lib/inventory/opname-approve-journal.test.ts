import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postOpnameJournal } from "./opname-journal";

// Exercises postOpnameJournal at the DB level, mirroring the approveOpname
// post-commit call. Never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("opname approve auto-journal integration (test bed only)", () => {
  let token: string;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let inventoryId: string;
  let varianceId: string;
  let opnameId: string;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-opname-approve-journal-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-A${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-OPN-A${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    const inventory = await prisma.chartAccount.create({
      data: { code: `8${token}1`, name: "Inventory (test)", type: "ASET", depth: 1, isActive: true },
    });
    inventoryId = inventory.id;
    const variance = await prisma.chartAccount.create({
      data: { code: `8${token}2`, name: "Inventory Variance (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    varianceId = variance.id;

    const opname = await prisma.stockOpname.create({
      data: {
        docNumber: `OPN-APPR-TEST-${token}`,
        scope: "FINISHED_GOOD",
        status: "CREATED",
        snapshotAt: new Date(),
        createdById: userId,
      },
      select: { id: true },
    });
    opnameId = opname.id;
  });

  afterEach(async () => {
    const journal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "OPNAME", sourceId: opnameId } },
      select: { id: true },
    });
    if (journal) {
      await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
      await prisma.journal.delete({ where: { id: journal.id } });
    }
    await prisma.journalAccountMapping.deleteMany({ where: { chartAccountId: { in: [inventoryId, varianceId] } } });
    await prisma.stockMovement.deleteMany({ where: { refType: "OPNAME", refId: opnameId } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [inventoryId, varianceId] } } });
    await prisma.stockOpname.delete({ where: { id: opnameId } });
    await prisma.item.delete({ where: { id: itemId } });
    await prisma.uOM.delete({ where: { id: uomId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function seedMovement(totalCost: number, qty: number): Promise<void> {
    await prisma.stockMovement.create({
      data: {
        itemId,
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: opnameId,
        refDocNumber: `OPN-APPR-TEST-${token}`,
        qty,
        totalCost,
        balanceQty: 0,
        balanceValue: 0,
      },
    });
  }

  it("roles mapped: postOpnameJournal posts a balanced DR INVENTORY / CR INVENTORY_VARIANCE journal", async () => {
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY" },
      create: { role: "INVENTORY", chartAccountId: inventoryId },
      update: { chartAccountId: inventoryId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY_VARIANCE" },
      create: { role: "INVENTORY_VARIANCE", chartAccountId: varianceId },
      update: { chartAccountId: varianceId },
    });

    await seedMovement(400, 4);

    const r = await postOpnameJournal(opnameId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "OPNAME", sourceId: opnameId } },
      include: { lines: true },
    });
    expect(j).not.toBeNull();
    expect(j!.lines).toHaveLength(2);

    const totalDebit = j!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = j!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    const invLine = j!.lines.find((l) => l.chartAccountId === inventoryId);
    const varLine = j!.lines.find((l) => l.chartAccountId === varianceId);
    expect(Number(invLine!.debit)).toBe(400);
    expect(Number(varLine!.credit)).toBe(400);
  });

  it("INVENTORY unmapped: postOpnameJournal returns UNMAPPED_ROLE", async () => {
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY_VARIANCE" },
      create: { role: "INVENTORY_VARIANCE", chartAccountId: varianceId },
      update: { chartAccountId: varianceId },
    });

    await seedMovement(400, 4);

    const r = await postOpnameJournal(opnameId, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "INVENTORY" });
  });
});
