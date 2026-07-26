import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("sales auto-journal (test bed only)", () => {
  let token: number;
  let userId: string;
  let orderId: string;
  let arId: string;
  let revId: string;
  let cogsId: string;
  let invId: string;
  let mappingSnapshot: MappingSnapshot;

  async function makeOrder(grandTotal: number, cogsPerItem: number[]): Promise<string> {
    const so = await prisma.salesOrder.create({
      data: {
        salesorderId: token,
        salesorderNo: `SO-${token}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "SHIPPED",
        subTotal: grandTotal,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal,
        shippedAt: new Date("2026-03-05"),
      },
      select: { id: true },
    });
    let detail = token * 10;
    for (const cogs of cogsPerItem) {
      await prisma.salesOrderItem.create({
        data: {
          salesOrderId: so.id,
          salesorderDetailId: detail++,
          jubelioItemId: detail,
          jubelioItemCode: `IT-${detail}`,
          productName: "Test",
          qty: 1,
          qtyInBase: 1,
          unitPrice: grandTotal,
          pricePaid: grandTotal,
          discAmount: 0,
          cogs,
        },
      });
    }
    return so.id;
  }

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000_000);
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);
    const user = await prisma.user.create({ data: { email: `test-sales-journal-${token}@test.local`, name: "Test Admin" } });
    userId = user.id;
    orderId = await makeOrder(1000, [300, 200]);

    const mk = async (code: string, name: string, type: "ASET" | "PENDAPATAN" | "HPP") =>
      (await prisma.chartAccount.create({ data: { code, name, type, depth: 1, isActive: true } })).id;
    arId = await mk(`9${token}1`, "Piutang (test)", "ASET");
    revId = await mk(`9${token}2`, "Penjualan (test)", "PENDAPATAN");
    cogsId = await mk(`9${token}3`, "HPP (test)", "HPP");
    invId = await mk(`9${token}4`, "Persediaan (test)", "ASET");
    const map = async (role: string, id: string) =>
      prisma.journalAccountMapping.upsert({ where: { role: role as never }, create: { role: role as never, chartAccountId: id }, update: { chartAccountId: id } });
    await map("AR", arId);
    await map("SALES_REVENUE", revId);
    await map("COGS", cogsId);
    await map("INVENTORY", invId);
  });

  afterEach(async () => {
    const journals = await prisma.journal.findMany({ where: { postedById: userId }, select: { id: true } });
    const ids = journals.map((j) => j.id);
    if (ids.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
      await prisma.journal.deleteMany({ where: { id: { in: ids } } });
    }
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({ where: { id: { in: [arId, revId, cogsId, invId] } } });
    await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { salesorderNo: { startsWith: `SO-${token}` } } } });
    await prisma.salesOrder.deleteMany({ where: { salesorderNo: { startsWith: `SO-${token}` } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("revenue posts DR AR 1000 / CR SALES_REVENUE 1000, dated shippedAt", async () => {
    const r = await postSalesRevenueJournal(orderId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESORDER_REVENUE", sourceId: orderId } }, include: { lines: true } });
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(1000);
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.credit)).toBe(1000);
    expect(j!.date.toISOString()).toBe(new Date("2026-03-05").toISOString());
  });

  it("cogs posts DR COGS 500 / CR INVENTORY 500 (sum of item cogs)", async () => {
    const r = await postSalesCogsJournal(orderId, userId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESORDER_COGS", sourceId: orderId } }, include: { lines: true } });
    expect(Number(j!.lines.find((l) => l.chartAccountId === cogsId)!.debit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === invId)!.credit)).toBe(500);
  });

  it("zero grandTotal → revenue NOTHING_TO_POST", async () => {
    const oid = await makeOrder(0, [10]);
    expect(await postSalesRevenueJournal(oid, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("no item cogs → cogs NOTHING_TO_POST", async () => {
    const so = await prisma.salesOrder.create({
      data: { salesorderId: token + 1, salesorderNo: `SO-${token}-b`, channel: "SHOPEE", sourceName: "t", status: "SHIPPED", subTotal: 50, totalDisc: 0, totalTax: 0, shippingCost: 0, grandTotal: 50 },
      select: { id: true },
    });
    await prisma.salesOrderItem.create({ data: { salesOrderId: so.id, salesorderDetailId: token * 10 + 99, jubelioItemId: 1, jubelioItemCode: "x", productName: "x", qty: 1, qtyInBase: 1, unitPrice: 50, pricePaid: 50, discAmount: 0 } });
    expect(await postSalesCogsJournal(so.id, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("unmapped AR → revenue UNMAPPED_ROLE", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "AR" } });
    expect(await postSalesRevenueJournal(orderId, userId, prisma)).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "AR" });
  });

  it("revenue is idempotent (re-post created:false)", async () => {
    const a = await postSalesRevenueJournal(orderId, userId, prisma);
    const b = await postSalesRevenueJournal(orderId, userId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
  });
});
