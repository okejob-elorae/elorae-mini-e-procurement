import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSalesReturnRevenueJournal, postSalesReturnCogsJournal } from "./sales-return-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("sales return auto-journal (test bed only)", () => {
  let token: number;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let returnId: string;
  let adjIds: string[];
  let arId: string;
  let revId: string;
  let cogsId: string;
  let invId: string;
  let mappingSnapshot: MappingSnapshot;

  // Creates a return with 2 ACCEPTED items (subtotals 300+200; restock 3*40 + 2*50 = 220) + 1 REJECTED (subtotal 100).
  async function makeReturn(): Promise<string> {
    const ret = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: token,
        jubelioReturnNo: `RET-${token}`,
        channel: "SHOPEE",
        totalQty: 5,
        totalValue: 500,
        receivedAt: new Date("2026-04-01"),
        decidedAt: new Date("2026-04-02"),
        status: "ACCEPTED",
        rawIngestPayload: {},
      },
      select: { id: true },
    });
    const mkAdj = async (n: number, qty: number, cost: number) => {
      const a = await prisma.stockAdjustment.create({
        data: {
          docNumber: `RETADJ-${token}-${n}`,
          itemId,
          type: "POSITIVE",
          qtyChange: qty,
          reason: "test restock",
          prevQty: 0,
          newQty: qty,
          prevAvgCost: cost,
          newAvgCost: cost,
          source: "ERP_RETURN_ACCEPT",
        },
        select: { id: true },
      });
      return a.id;
    };
    adjIds = [await mkAdj(1, 3, 40), await mkAdj(2, 2, 50)];
    await prisma.salesReturnItem.create({ data: { salesReturnId: ret.id, externalSku: "A", productName: "A", qty: 3, unitPrice: 100, subtotal: 300, decision: "ACCEPTED", stockAdjustmentId: adjIds[0] } });
    await prisma.salesReturnItem.create({ data: { salesReturnId: ret.id, externalSku: "B", productName: "B", qty: 2, unitPrice: 100, subtotal: 200, decision: "ACCEPTED", stockAdjustmentId: adjIds[1] } });
    await prisma.salesReturnItem.create({ data: { salesReturnId: ret.id, externalSku: "C", productName: "C", qty: 1, unitPrice: 100, subtotal: 100, decision: "REJECTED" } });
    return ret.id;
  }

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);
    const user = await prisma.user.create({ data: { email: `test-sret-journal-${token}@test.local`, name: "Test Admin" } });
    userId = user.id;
    const uom = await prisma.uOM.create({ data: { code: `UOM-${token}`, nameId: "t", nameEn: "t" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: `RET-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", isActive: true, uomId } });
    itemId = item.id;
    returnId = await makeReturn();

    const mk = async (code: string, type: "ASET" | "PENDAPATAN" | "HPP") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    arId = await mk(`9${token}1`, "ASET");
    revId = await mk(`9${token}2`, "PENDAPATAN");
    cogsId = await mk(`9${token}3`, "HPP");
    invId = await mk(`9${token}4`, "ASET");
    const map = async (role: string, id: string) => prisma.journalAccountMapping.upsert({ where: { role: role as never }, create: { role: role as never, chartAccountId: id }, update: { chartAccountId: id } });
    await map("AR", arId); await map("SALES_REVENUE", revId); await map("COGS", cogsId); await map("INVENTORY", invId);
  });

  afterEach(async () => {
    const journals = await prisma.journal.findMany({ where: { postedById: userId }, select: { id: true } });
    const jids = journals.map((j) => j.id);
    if (jids.length) { await prisma.journalLine.deleteMany({ where: { journalId: { in: jids } } }); await prisma.journal.deleteMany({ where: { id: { in: jids } } }); }
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({ where: { id: { in: [arId, revId, cogsId, invId] } } });
    await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: returnId } });
    await prisma.salesReturn.delete({ where: { id: returnId } });
    await prisma.stockAdjustment.deleteMany({ where: { id: { in: adjIds } } });
    await prisma.item.delete({ where: { id: itemId } });
    await prisma.uOM.delete({ where: { id: uomId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("revenue reversal posts DR SALES_REVENUE 500 / CR AR 500 (Σ accepted subtotal), dated decidedAt", async () => {
    const r = await postSalesReturnRevenueJournal(returnId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESRETURN_REVENUE", sourceId: returnId } }, include: { lines: true } });
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.debit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(500);
    expect(j!.date.toISOString()).toBe(new Date("2026-04-02").toISOString());
  });

  it("cogs reversal posts DR INVENTORY 220 / CR COGS 220 (Σ restock cost)", async () => {
    const r = await postSalesReturnCogsJournal(returnId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESRETURN_COGS", sourceId: returnId } }, include: { lines: true } });
    expect(Number(j!.lines.find((l) => l.chartAccountId === invId)!.debit)).toBe(220);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cogsId)!.credit)).toBe(220);
  });

  it("no accepted items → both NOTHING_TO_POST", async () => {
    await prisma.salesReturnItem.updateMany({ where: { salesReturnId: returnId }, data: { decision: "REJECTED" } });
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("unmapped AR → revenue UNMAPPED_ROLE", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "AR" } });
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "AR" });
  });

  it("revenue is idempotent (re-post created:false)", async () => {
    const a = await postSalesReturnRevenueJournal(returnId, userId, prisma);
    const b = await postSalesReturnRevenueJournal(returnId, userId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
  });
});
