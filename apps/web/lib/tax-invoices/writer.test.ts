import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { markTaxInvoiceCreated, markTaxInvoiceNotRequired, markTaxInvoiceSentToStore, revertTaxInvoiceToPending } from "./writer";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";

/* Stock-mutating (goes through the real delivery writer) — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const defaultInvoiceDate = new Date("2026-01-01T00:00:00.000+07:00");
const defaultDueDate = new Date("2026-01-08T00:00:00.000+07:00");
const NPWP = "01.234.567.8-901.000";

d("tax-invoice status transitions (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let deliveryId = "";
  let taxInvoiceId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineId = ""; deliveryId = ""; taxInvoiceId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-TI-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-TI-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 5, avgCost: 500, totalValue: 5000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-TI-STORE-${token}`, name: "Test TI Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-ti-${token}@example.com`, name: "Test TI Finance" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-TI-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 5000,
        total: 5000,
        lines: {
          create: [{ itemId, variantSku: "", productName: "Test TI Product", qty: 5, unitPrice: 1000, lineTotal: 5000 }],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 5, state: "RESERVED" },
    });

    const delivery = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 5 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    deliveryId = delivery.deliveryId;

    const taxInvoice = await prisma.taxInvoice.findUniqueOrThrow({ where: { deliveryId } });
    taxInvoiceId = taxInvoice.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId) } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("PENDING -> CREATED stamps the number, NPWP, amounts, the marker and the time", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("CREATED");
    expect(row.invoiceNo).toBe("010.000-26.00000001");
    expect(row.buyerNpwp).toBe(NPWP);
    expect(Number(row.taxableAmount)).toBe(5000);
    expect(Number(row.ppnAmount)).toBe(550);
    expect(row.markedById).toBe(userId);
    expect(row.markedAt).not.toBeNull();
  });

  it("rounds taxableAmount and ppnAmount to 2dp", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: NPWP, taxableAmount: 5000.005, ppnAmount: 550.004, userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(Number(row.taxableAmount)).toBe(5000.01);
    expect(Number(row.ppnAmount)).toBe(550);
  });

  it("rejects an empty invoiceNo with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "   ", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects an empty buyerNpwp with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: "  ", taxableAmount: 5000, ppnAmount: 550, userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a negative taxableAmount with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: NPWP, taxableAmount: -1, ppnAmount: 550, userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a negative ppnAmount with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: -1, userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("accepts a zero taxableAmount and ppnAmount", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", buyerNpwp: NPWP, taxableAmount: 0, ppnAmount: 0, userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(Number(row.taxableAmount)).toBe(0);
    expect(Number(row.ppnAmount)).toBe(0);
  });

  it("rejects an empty reason on NOT_REQUIRED with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceNotRequired({ taxInvoiceId, reason: "", userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("CREATED -> CREATED is INVALID_STATE", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000002", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000003", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("CREATED -> SENT_TO_STORE preserves invoiceNo, NPWP, amounts, markedAt and markedById", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000004", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    const before = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    await markTaxInvoiceSentToStore({ taxInvoiceId, reason: "handed to store owner", userId });
    const after = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(after.status).toBe("SENT_TO_STORE");
    expect(after.invoiceNo).toBe(before.invoiceNo);
    expect(after.buyerNpwp).toBe(before.buyerNpwp);
    expect(Number(after.taxableAmount)).toBe(Number(before.taxableAmount));
    expect(Number(after.ppnAmount)).toBe(Number(before.ppnAmount));
    expect(after.markedAt?.getTime()).toBe(before.markedAt?.getTime());
    expect(after.markedById).toBe(before.markedById);
  });

  it("markTaxInvoiceSentToStore accepts a null/absent reason", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000005", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await expect(markTaxInvoiceSentToStore({ taxInvoiceId, userId })).resolves.toEqual({ ok: true });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("SENT_TO_STORE");
  });

  it("refuses PENDING -> SENT_TO_STORE with INVALID_STATE", async () => {
    await expect(markTaxInvoiceSentToStore({ taxInvoiceId, userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses NOT_REQUIRED -> SENT_TO_STORE with INVALID_STATE", async () => {
    await markTaxInvoiceNotRequired({ taxInvoiceId, reason: "export sale", userId });
    await expect(markTaxInvoiceSentToStore({ taxInvoiceId, userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("CREATED -> PENDING clears the number, NPWP and amounts, and records the reason", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000006", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await revertTaxInvoiceToPending({ taxInvoiceId, reason: "wrong nota", userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("PENDING");
    expect(row.invoiceNo).toBeNull();
    expect(row.buyerNpwp).toBeNull();
    expect(row.taxableAmount).toBeNull();
    expect(row.ppnAmount).toBeNull();
    expect(row.reason).toBe("wrong nota");
  });

  it("SENT_TO_STORE -> PENDING clears all four value fields", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000007", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await markTaxInvoiceSentToStore({ taxInvoiceId, userId });
    await revertTaxInvoiceToPending({ taxInvoiceId, reason: "handed to wrong store contact", userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("PENDING");
    expect(row.invoiceNo).toBeNull();
    expect(row.buyerNpwp).toBeNull();
    expect(row.taxableAmount).toBeNull();
    expect(row.ppnAmount).toBeNull();
  });

  it("reverting an already-PENDING row is INVALID_STATE", async () => {
    await expect(revertTaxInvoiceToPending({ taxInvoiceId, reason: "x", userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("writes exactly one AuditLog row on a successful transition", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000008", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId) },
    });
    expect(logs).toHaveLength(1);
  });

  it("writes a TAX_INVOICE_SENT_TO_STORE audit action on the handover transition", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000009", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await markTaxInvoiceSentToStore({ taxInvoiceId, reason: "handed over", userId });
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId), action: "TAX_INVOICE_SENT_TO_STORE" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toBe("handed over");
  });

  it("captures the pre-transition invoiceNo and NPWP in the audit changes when reverting a CREATED row", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000010", buyerNpwp: NPWP, taxableAmount: 5000, ppnAmount: 550, userId });
    await revertTaxInvoiceToPending({ taxInvoiceId, reason: "typed against the wrong nota", userId });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId), action: "TAX_INVOICE_REVERTED" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toBe("typed against the wrong nota");
    expect(logs[0].changes).toMatchObject({
      before: { status: "CREATED", invoiceNo: "010.000-26.00000010", buyerNpwp: NPWP },
      after: { status: "PENDING", invoiceNo: null, buyerNpwp: null },
    });

    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.invoiceNo).toBeNull();
  });

  it("writes no AuditLog row when the transition is rejected", async () => {
    await expect(revertTaxInvoiceToPending({ taxInvoiceId, reason: "x", userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId) },
    });
    expect(logs).toHaveLength(0);
  });
});
