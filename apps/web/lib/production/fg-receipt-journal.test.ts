import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postFgReceiptJournal } from "./fg-receipt-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("FG receipt auto-journal (test bed only)", () => {
  let token: string;
  let userId: string;
  let supplierTypeId: string;
  let vendorId: string;
  let uomId: string;
  let itemId: string;
  let woId: string;
  let receiptId: string;
  let fgId: string;
  let rawId: string;
  let mappingSnapshot: MappingSnapshot;

  async function makeReceipt(qtyAccepted: number, totalCostValue: number): Promise<string> {
    const r = await prisma.fGReceipt.create({
      data: {
        docNumber: `RCPT-${token}-${Math.round(totalCostValue)}-${qtyAccepted}`,
        woId,
        receiptType: "GENERIC",
        qtyReceived: qtyAccepted,
        qtyRejected: 0,
        qtyAccepted,
        totalCostValue,
        avgCostPerUnit: qtyAccepted > 0 ? totalCostValue / qtyAccepted : 0,
        materialCost: totalCostValue,
        receivedById: userId,
        receivedAt: new Date("2026-02-10"),
      },
      select: { id: true },
    });
    return r.id;
  }

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(["INVENTORY", "INVENTORY_FG"]);

    const user = await prisma.user.create({
      data: { email: `test-fg-journal-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;
    const st = await prisma.supplierType.create({ data: { code: `ST-${token}`, name: "Test Type" } });
    supplierTypeId = st.id;
    const vendor = await prisma.supplier.create({
      data: { code: `SUP-${token}`, name: "Test Vendor", typeId: supplierTypeId },
    });
    vendorId = vendor.id;
    const uom = await prisma.uOM.create({ data: { code: `UOM-${token}`, nameId: "t", nameEn: "t" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `FG-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-${token}`,
        vendorId,
        finishedGoodId: itemId,
        plannedQty: 10,
        consumptionPlan: {},
        createdById: userId,
        outputMode: "GENERIC",
      },
      select: { id: true },
    });
    woId = wo.id;
    receiptId = await makeReceipt(10, 500);

    const fg = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Persediaan FG (test)", type: "ASET", depth: 1, isActive: true },
    });
    fgId = fg.id;
    const raw = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Persediaan (test)", type: "ASET", depth: 1, isActive: true },
    });
    rawId = raw.id;
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY_FG" }, create: { role: "INVENTORY_FG", chartAccountId: fgId }, update: { chartAccountId: fgId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY" }, create: { role: "INVENTORY", chartAccountId: rawId }, update: { chartAccountId: rawId },
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
    await prisma.chartAccount.deleteMany({ where: { id: { in: [fgId, rawId] } } });
    await prisma.fGReceipt.deleteMany({ where: { woId } });
    await prisma.workOrder.delete({ where: { id: woId } });
    await prisma.item.delete({ where: { id: itemId } });
    await prisma.uOM.delete({ where: { id: uomId } });
    await prisma.supplier.delete({ where: { id: vendorId } });
    await prisma.supplierType.delete({ where: { id: supplierTypeId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("posts DR Persediaan FG 500 / CR Persediaan 500, dated receivedAt", async () => {
    const r = await postFgReceiptJournal(receiptId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "FG_RECEIPT", sourceId: receiptId } },
      include: { lines: true },
    });
    const fg = j!.lines.find((l) => l.chartAccountId === fgId);
    const raw = j!.lines.find((l) => l.chartAccountId === rawId);
    expect(Number(fg!.debit)).toBe(500);
    expect(Number(raw!.credit)).toBe(500);
    expect(j!.date.toISOString()).toBe(new Date("2026-02-10").toISOString());
  });

  it("qtyAccepted 0 → NOTHING_TO_POST", async () => {
    const rid = await makeReceipt(0, 0);
    const r = await postFgReceiptJournal(rid, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("zero value → NOTHING_TO_POST", async () => {
    const rid = await makeReceipt(5, 0);
    const r = await postFgReceiptJournal(rid, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("unmapped INVENTORY_FG → UNMAPPED_ROLE", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "INVENTORY_FG" } });
    const r = await postFgReceiptJournal(receiptId, userId, prisma);
    expect(r).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "INVENTORY_FG" });
  });

  it("is idempotent (re-post returns created:false)", async () => {
    const a = await postFgReceiptJournal(receiptId, userId, prisma);
    const b = await postFgReceiptJournal(receiptId, userId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
  });
});
