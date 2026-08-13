import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { markTaxInvoiceCreated, markTaxInvoiceNotRequired, revertTaxInvoiceToPending } from "./writer";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";

/* Stock-mutating (goes through the real delivery writer) — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const defaultInvoiceDate = new Date("2026-01-01T00:00:00.000+07:00");
const defaultDueDate = new Date("2026-01-08T00:00:00.000+07:00");

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
    await prisma.taxInvoice.deleteMany({ where: { id: seededId(taxInvoiceId) } });
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

  it("PENDING -> CREATED stamps the number, the marker and the time", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000001", userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("CREATED");
    expect(row.invoiceNo).toBe("010.000-26.00000001");
    expect(row.markedById).toBe(userId);
    expect(row.markedAt).not.toBeNull();
  });

  it("rejects an empty invoiceNo with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "   ", userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects an empty reason on NOT_REQUIRED with INVALID_REQUEST", async () => {
    await expect(markTaxInvoiceNotRequired({ taxInvoiceId, reason: "", userId }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("CREATED -> CREATED is INVALID_STATE", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000002", userId });
    await expect(markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000003", userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("CREATED -> PENDING clears the number and records the reason", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000004", userId });
    await revertTaxInvoiceToPending({ taxInvoiceId, reason: "wrong nota", userId });
    const row = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(taxInvoiceId) } });
    expect(row.status).toBe("PENDING");
    expect(row.invoiceNo).toBeNull();
    expect(row.reason).toBe("wrong nota");
  });

  it("reverting an already-PENDING row is INVALID_STATE", async () => {
    await expect(revertTaxInvoiceToPending({ taxInvoiceId, reason: "x", userId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("writes an AuditLog row in the same transaction as the update", async () => {
    await markTaxInvoiceCreated({ taxInvoiceId, invoiceNo: "010.000-26.00000005", userId });
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "TaxInvoice", entityId: seededId(taxInvoiceId) },
    });
    expect(logs).toHaveLength(1);
  });
});
