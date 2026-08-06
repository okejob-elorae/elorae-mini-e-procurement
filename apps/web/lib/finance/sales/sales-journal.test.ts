import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";
import { type PostingRole } from "@/lib/constants/journal-roles";

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

  let soSeq = 0;
  async function makeOrder(grandTotal: number, cogsPerItem: number[]): Promise<string> {
    soSeq += 1;
    const base = token * 100 + soSeq; // unique per call, < ~1e8
    const so = await prisma.salesOrder.create({
      data: {
        salesorderId: base,
        salesorderNo: `SO-${token}-${soSeq}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "SHIPPED",
        subTotal: grandTotal,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal,
        transactionDate: new Date("2026-03-05"),
        shippedAt: new Date("2026-03-05"),
      },
      select: { id: true },
    });
    let i = 0;
    for (const cogs of cogsPerItem) {
      await prisma.salesOrderItem.create({
        data: {
          salesOrderId: so.id,
          salesorderDetailId: base * 10 + i, // < ~1e9, unique
          jubelioItemId: base * 10 + i,
          jubelioItemCode: `IT-${base}-${i}`,
          productName: "Test",
          qty: 1,
          qtyInBase: 1,
          unitPrice: grandTotal,
          pricePaid: grandTotal,
          discAmount: 0,
          taxAmount: 0,
          lineTotal: grandTotal,
          cogs,
        },
      });
      i += 1;
    }
    return so.id;
  }

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
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
      prisma.journalAccountMapping.upsert({ where: { role: role as PostingRole }, create: { role: role as PostingRole, chartAccountId: id }, update: { chartAccountId: id } });
    await map("AR", arId);
    await map("SALES_REVENUE", revId);
    await map("COGS", cogsId);
    await map("INVENTORY", invId);
  });

  afterEach(async () => {
    const failures: string[] = [];
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${what}: ${String(e)}`);
      }
    };

    /*
     * Shared config first — JournalAccountMapping is live GL config the running ERP reads,
     * and no bookkeeping delete below may stand between a failure and restoring it. The step
     * name carries the mapping the bed should end up holding, so a failed restore names its
     * own remedy.
     */
    await step(`restoreMappings (→ ${JSON.stringify(mappingSnapshot)})`, () => restoreMappings(mappingSnapshot));

    /*
     * Own-row filters below are coalesced to never-matching values: a beforeEach that dies
     * partway leaves these ids undefined, Prisma drops an undefined filter term, and a
     * deleteMany with an empty where clears the whole table on the shared bed.
     */
    await step("journals", async () => {
      const journals = await prisma.journal.findMany({ where: { postedById: userId ?? "" }, select: { id: true } });
      const ids = journals.map((j) => j.id);
      if (ids.length) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
        await prisma.journal.deleteMany({ where: { id: { in: ids } } });
      }
    });
    await step("accounts", () => prisma.chartAccount.deleteMany({ where: { id: { in: [arId, revId, cogsId, invId].filter(Boolean) } } }));
    await step("items", () => prisma.salesOrderItem.deleteMany({ where: { salesOrder: { salesorderNo: { startsWith: `SO-${token}` } } } }));
    await step("orders", () => prisma.salesOrder.deleteMany({ where: { salesorderNo: { startsWith: `SO-${token}` } } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: userId ?? "" } }));

    if (failures.length) throw new Error(`sales journal spec teardown failed — ${failures.join(" | ")}`);
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
      data: {
        salesorderId: token * 100 + 90,
        salesorderNo: `SO-${token}-nocogs`,
        channel: "SHOPEE",
        sourceName: "t",
        status: "SHIPPED",
        subTotal: 50,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 50,
        transactionDate: new Date("2026-03-05"),
      },
      select: { id: true },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: so.id,
        salesorderDetailId: (token * 100 + 90) * 10,
        jubelioItemId: 1,
        jubelioItemCode: "x",
        productName: "x",
        qty: 1,
        qtyInBase: 1,
        unitPrice: 50,
        pricePaid: 50,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 50,
      },
    });
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
