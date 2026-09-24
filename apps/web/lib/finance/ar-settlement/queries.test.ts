import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getSettlementForApproval, getSettlementForPrint } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * A sell-through-backed invoice's `docNo` now resolves through `resolveReceivableSource` rather
 * than `receivable.delivery.docNo` — `Receivable.delivery` is optional as of the delivery/
 * sell-through source split, so a receivable backed by a `KonsiSellThrough` report has a `null`
 * `delivery` here. Pins both settlement-detail readers against that shape.
 */
d("settlement queries — sell-through source (test bed only)", () => {
  let token = "";
  let storeId = "";
  let salesmanId = "";
  let sellThroughId = "";
  let sellThroughRecId = "";
  let settlementId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; salesmanId = ""; sellThroughId = ""; sellThroughRecId = ""; settlementId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-STQ-${token}`, name: `Toko ${token}`, address: "test", termsType: "KONSI" },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({
      data: { email: `stq-sales-${token}@test.local`, name: `Sales ${token}` },
    });
    salesmanId = salesman.id;

    const sellThrough = await prisma.konsiSellThrough.create({
      data: {
        docNo: `TEST-STQ-KST-${token}`,
        storeId,
        method: "SPG_POS",
        closingStocktakeId: `TEST-STQ-STK-${token}`,
        periodStart: new Date("2026-05-01T00:00:00.000+07:00"),
        periodEnd: new Date("2026-05-31T00:00:00.000+07:00"),
        salesmanId,
        createdById: salesmanId,
      },
    });
    sellThroughId = sellThrough.id;

    const sellThroughRec = await prisma.receivable.create({
      data: {
        sellThroughId, storeId,
        invoiceDate: new Date("2026-05-31T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-30T00:00:00.000+07:00"),
        originalAmount: 500, outstandingAmount: 500,
      },
    });
    sellThroughRecId = sellThroughRec.id;

    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-STQ-BKM-${token}`,
        storeId,
        salesmanId,
        expectedAmount: 500,
        actualAmount: 500,
        varianceAmount: 0,
        status: "PENDING",
        invoices: { create: [{ receivableId: sellThroughRecId, amount: 500 }] },
      },
      select: { id: true },
    });
    settlementId = settlement.id;
  });

  afterEach(async () => {
    await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: seededId(settlementId) } });
    await prisma.storeSettlement.deleteMany({ where: { id: seededId(settlementId) } });
    /* Child of the 1:1 relation to KonsiSellThrough goes before its parent. */
    await prisma.receivable.deleteMany({ where: { id: seededId(sellThroughRecId) } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: seededId(sellThroughId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("getSettlementForApproval resolves a sell-through-backed invoice's docNo instead of throwing", async () => {
    const detail = await getSettlementForApproval(settlementId);
    expect(detail).not.toBeNull();
    const invoice = detail!.invoices.find((i) => i.receivableId === sellThroughRecId);
    expect(invoice?.docNo).toBe(`TEST-STQ-KST-${token}`);
  });

  it("getSettlementForPrint resolves a sell-through-backed invoice's docNo instead of throwing", async () => {
    const detail = await getSettlementForPrint(settlementId);
    expect(detail).not.toBeNull();
    const invoice = detail!.invoices.find((i) => i.agreedAmount === 500);
    expect(invoice?.docNo).toBe(`TEST-STQ-KST-${token}`);
  });
});
