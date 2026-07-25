import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { opnameNetDelta, postOpnameJournal } from "./opname-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

// Posts journal + mapping rows and stock movements — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postOpnameJournal (test bed only)", () => {
  let token: string;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let inventoryId: string;
  let varianceId: string;
  let opnameId: string;
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(["INVENTORY", "INVENTORY_VARIANCE"]);

    const user = await prisma.user.create({
      data: { email: `test-opname-journal-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-OPN-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    const inventory = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Inventory (test)", type: "ASET", depth: 1, isActive: true },
    });
    inventoryId = inventory.id;
    const variance = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Inventory Variance (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    varianceId = variance.id;

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

    const opname = await prisma.stockOpname.create({
      data: {
        docNumber: `OPN-TEST-${token}`,
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
    await restoreMappings(mappingSnapshot);
    await prisma.stockMovement.deleteMany({ where: { refType: "OPNAME", refId: opnameId } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [inventoryId, varianceId] } } });
    await prisma.stockOpname.delete({ where: { id: opnameId } });
    await prisma.item.delete({ where: { id: itemId } });
    await prisma.uOM.delete({ where: { id: uomId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function seedMovement(totalCost: number | null, qty: number): Promise<void> {
    await prisma.stockMovement.create({
      data: {
        itemId,
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: opnameId,
        refDocNumber: `OPN-TEST-${token}`,
        qty,
        totalCost: totalCost ?? undefined,
        balanceQty: 0,
        balanceValue: 0,
      },
    });
  }

  it("opnameNetDelta sums totalCost across movements, treating null as 0", async () => {
    await seedMovement(300, 3);
    await seedMovement(null, 0);
    await seedMovement(200, 2);
    expect(await opnameNetDelta(opnameId, prisma)).toBe(500);
  });

  it("surplus (net +500) posts DR INVENTORY 500 / CR INVENTORY_VARIANCE 500, balanced", async () => {
    await seedMovement(500, 5);

    const r = await postOpnameJournal(opnameId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "OPNAME", sourceId: opnameId } },
      include: { lines: true },
    });
    expect(j!.lines).toHaveLength(2);
    const totalDebit = j!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = j!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    const invLine = j!.lines.find((l) => l.chartAccountId === inventoryId);
    const varLine = j!.lines.find((l) => l.chartAccountId === varianceId);
    expect(Number(invLine!.debit)).toBe(500);
    expect(Number(invLine!.credit)).toBe(0);
    expect(Number(varLine!.debit)).toBe(0);
    expect(Number(varLine!.credit)).toBe(500);
  });

  it("shrinkage (net -300) posts DR INVENTORY_VARIANCE 300 / CR INVENTORY 300", async () => {
    await seedMovement(-300, -3);

    const r = await postOpnameJournal(opnameId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "OPNAME", sourceId: opnameId } },
      include: { lines: true },
    });
    expect(j!.lines).toHaveLength(2);

    const invLine = j!.lines.find((l) => l.chartAccountId === inventoryId);
    const varLine = j!.lines.find((l) => l.chartAccountId === varianceId);
    expect(Number(invLine!.debit)).toBe(0);
    expect(Number(invLine!.credit)).toBe(300);
    expect(Number(varLine!.debit)).toBe(300);
    expect(Number(varLine!.credit)).toBe(0);
  });

  it("net 0 returns NOTHING_TO_POST", async () => {
    await seedMovement(300, 3);
    await seedMovement(-300, -3);

    const r = await postOpnameJournal(opnameId, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("is idempotent (re-post returns created:false)", async () => {
    await seedMovement(500, 5);
    const a = await postOpnameJournal(opnameId, userId, prisma);
    const b = await postOpnameJournal(opnameId, userId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
    if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
  });
});
