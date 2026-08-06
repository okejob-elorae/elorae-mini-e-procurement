import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSalesReturnRevenueJournal, postSalesReturnCogsJournal } from "./sales-return-journal";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("sales return auto-journal (test bed only)", () => {
  let token: number;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let orderId: string;
  let returnId: string;
  let adjIds: string[];
  let arId: string;
  let revId: string;
  let cogsId: string;
  let invId: string;
  let mappingSnapshot: MappingSnapshot;

  /*
   * The original sale every return here reverses: grandTotal 1000 and one line
   * costed 400, so both sale legs carry a non-trivial value and can actually be
   * journaled. Journaling it is a per-test decision — the gate under test asks
   * whether this ledger recognized the sale, so the fixture has to be able to
   * present it both ways.
   */
  async function makeOrder(): Promise<string> {
    const so = await prisma.salesOrder.create({
      data: {
        salesorderId: token,
        salesorderNo: `SO-RET-${token}`,
        channel: "SHOPEE",
        sourceName: "t",
        status: "COMPLETED",
        subTotal: 1000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 1000,
        transactionDate: new Date("2026-03-01"),
        shippedAt: new Date("2026-03-02"),
        shippedById: userId,
      },
      select: { id: true },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: so.id,
        salesorderDetailId: token,
        jubelioItemId: 1,
        jubelioItemCode: "x",
        productName: "x",
        qty: 5,
        qtyInBase: 5,
        unitPrice: 200,
        pricePaid: 200,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 1000,
        cogs: 400,
      },
    });
    return so.id;
  }

  /* Creates a return with 2 ACCEPTED items (subtotals 300+200; restock 3*40 + 2*50 = 220) + 1 REJECTED (subtotal 100). */
  async function makeReturn(): Promise<string> {
    const ret = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: token,
        jubelioReturnNo: `RET-${token}`,
        salesOrderId: orderId,
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

  /*
   * Posts the sale's own two journals through the real writers rather than
   * hand-inserting rows, so the gate is tested against exactly the
   * `(sourceType, sourceId)` pairs production writes.
   */
  async function journalTheSale(): Promise<void> {
    expect(await postSalesRevenueJournal(orderId, userId, prisma)).toMatchObject({ ok: true });
    expect(await postSalesCogsJournal(orderId, userId, prisma)).toMatchObject({ ok: true });
  }

  /* Removes named sale legs from the ledger, to stage a sale this GL never recognized. */
  async function unjournalTheSale(sourceTypes: string[]): Promise<void> {
    const journals = await prisma.journal.findMany({
      where: { sourceId: orderId, sourceType: { in: sourceTypes } },
      select: { id: true },
    });
    const ids = journals.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
    await prisma.journal.deleteMany({ where: { id: { in: ids } } });
  }

  const returnJournalCount = (): Promise<number> =>
    prisma.journal.count({ where: { sourceId: returnId ?? "" } });

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);
    const user = await prisma.user.create({ data: { email: `test-sret-journal-${token}@test.local`, name: "Test Admin" } });
    userId = user.id;
    const uom = await prisma.uOM.create({ data: { code: `UOM-${token}`, nameId: "t", nameEn: "t" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: `RET-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", isActive: true, uomId } });
    itemId = item.id;

    const mk = async (code: string, type: "ASET" | "PENDAPATAN" | "HPP") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    arId = await mk(`9${token}1`, "ASET");
    revId = await mk(`9${token}2`, "PENDAPATAN");
    cogsId = await mk(`9${token}3`, "HPP");
    invId = await mk(`9${token}4`, "ASET");
    const map = async (role: string, id: string) => prisma.journalAccountMapping.upsert({ where: { role: role as never }, create: { role: role as never, chartAccountId: id }, update: { chartAccountId: id } });
    await map("AR", arId); await map("SALES_REVENUE", revId); await map("COGS", cogsId); await map("INVENTORY", invId);

    orderId = await makeOrder();
    returnId = await makeReturn();
    await journalTheSale();
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
      const jids = journals.map((j) => j.id);
      if (jids.length) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: jids } } });
        await prisma.journal.deleteMany({ where: { id: { in: jids } } });
      }
    });
    await step("accounts", () => prisma.chartAccount.deleteMany({ where: { id: { in: [arId, revId, cogsId, invId].filter(Boolean) } } }));
    await step("returnItems", () => prisma.salesReturnItem.deleteMany({ where: { salesReturnId: returnId ?? "" } }));
    await step("returns", () => prisma.salesReturn.deleteMany({ where: { id: returnId ?? "" } }));
    await step("orderItems", () => prisma.salesOrderItem.deleteMany({ where: { salesOrderId: orderId ?? "" } }));
    await step("orders", () => prisma.salesOrder.deleteMany({ where: { id: orderId ?? "" } }));
    await step("adjustments", () => prisma.stockAdjustment.deleteMany({ where: { id: { in: adjIds ?? [] } } }));
    await step("item", () => prisma.item.deleteMany({ where: { id: itemId ?? "" } }));
    await step("uom", () => prisma.uOM.deleteMany({ where: { id: uomId ?? "" } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: userId ?? "" } }));

    if (failures.length) throw new Error(`sales return journal spec teardown failed — ${failures.join(" | ")}`);
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

  it("original sale never journaled → both legs refuse ORIGINAL_SALE_NOT_JOURNALED and post nothing", async () => {
    await unjournalTheSale(["SALESORDER_REVENUE", "SALESORDER_COGS"]);
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await returnJournalCount()).toBe(0);
  });

  it("return not traceable to an order (salesOrderId null) → both legs refuse and post nothing", async () => {
    await prisma.salesReturn.update({ where: { id: returnId }, data: { salesOrderId: null } });
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await returnJournalCount()).toBe(0);
  });

  it("only the sale's revenue leg is on the books → revenue reversal posts, cogs reversal refuses", async () => {
    await unjournalTheSale(["SALESORDER_COGS"]);
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await returnJournalCount()).toBe(1);
  });

  it("zero-value return still reports NOTHING_TO_POST, even with no sale journal to reverse", async () => {
    await unjournalTheSale(["SALESORDER_REVENUE", "SALESORDER_COGS"]);
    await prisma.salesReturnItem.updateMany({ where: { salesReturnId: returnId }, data: { decision: "REJECTED" } });
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("a retry after the sweep journals the sale posts what it refused before", async () => {
    await unjournalTheSale(["SALESORDER_REVENUE", "SALESORDER_COGS"]);
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" });
    expect(await returnJournalCount()).toBe(0);

    await journalTheSale();
    expect(await postSalesReturnRevenueJournal(returnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    expect(await postSalesReturnCogsJournal(returnId, userId, prisma)).toMatchObject({ ok: true, created: true });
    expect(await returnJournalCount()).toBe(2);
  });
});
