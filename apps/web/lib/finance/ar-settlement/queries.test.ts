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

/*
 * An orphan — a receivable whose `deliveryId` points at no `FieldSalesDelivery` — reads back with
 * neither source relation (`relationMode = "prisma"` puts no FK behind the column, so a dangling id
 * satisfies the one-source CHECK). Both settlement readers must render it rather than throw
 * `ReceivableSourceMissingError`: the approval detail with a `null` docNo, the printed BKM with the
 * receivable id in its place.
 */
d("settlement queries — orphaned receivable (test bed only)", () => {
  let token = "";
  let storeId = "";
  let salesmanId = "";
  let orphanRecId = "";
  let settlementId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; salesmanId = ""; orphanRecId = ""; settlementId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-STQO-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({
      data: { email: `stqo-sales-${token}@test.local`, name: `Sales ${token}` },
    });
    salesmanId = salesman.id;

    const orphan = await prisma.receivable.create({
      data: {
        deliveryId: `dangling-${token}`, storeId,
        invoiceDate: new Date("2026-05-31T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-30T00:00:00.000+07:00"),
        originalAmount: 700, outstandingAmount: 700,
      },
    });
    orphanRecId = orphan.id;

    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-STQO-BKM-${token}`,
        storeId,
        salesmanId,
        expectedAmount: 700,
        actualAmount: 700,
        varianceAmount: 0,
        status: "PENDING",
        invoices: { create: [{ receivableId: orphanRecId, amount: 700 }] },
      },
      select: { id: true },
    });
    settlementId = settlement.id;
  });

  afterEach(async () => {
    await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: seededId(settlementId) } });
    await prisma.storeSettlement.deleteMany({ where: { id: seededId(settlementId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(orphanRecId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("getSettlementForApproval renders an orphaned invoice with a null docNo instead of throwing", async () => {
    const detail = await getSettlementForApproval(settlementId);
    expect(detail).not.toBeNull();
    const invoice = detail!.invoices.find((i) => i.receivableId === orphanRecId);
    expect(invoice).toBeDefined();
    expect(invoice?.docNo).toBeNull();
  });

  it("getSettlementForPrint prints an orphaned invoice under its receivable id instead of throwing", async () => {
    const detail = await getSettlementForPrint(settlementId);
    expect(detail).not.toBeNull();
    const invoice = detail!.invoices.find((i) => i.agreedAmount === 700);
    expect(invoice?.docNo).toBe(orphanRecId);
  });
});
