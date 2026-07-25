import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postGrnJournal, postGrnReversalJournal } from "./grn-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("GRN auto-journal (test bed only)", () => {
  let token: string;
  let userId: string;
  let supplierId: string;
  let grnId: string;
  let supplierTypeId: string;
  let inventoryId: string;
  let apId: string;
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(["INVENTORY", "AP"]);

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

    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY" }, create: { role: "INVENTORY", chartAccountId: inventoryId }, update: { chartAccountId: inventoryId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "AP" }, create: { role: "AP", chartAccountId: apId }, update: { chartAccountId: apId },
    });
  });

  afterEach(async () => {
    const journals = await prisma.journal.findMany({ where: { postedById: userId }, select: { id: true } });
    const ids = journals.map((j) => j.id);
    if (ids.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
      await prisma.journal.deleteMany({ where: { id: { in: ids } } });
    }
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({ where: { id: { in: [inventoryId, apId] } } });
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
});
