import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listReceivablesForExport } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listReceivablesForExport (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = ""; orderId = ""; deliveryId = ""; receivableId = "";

    const store = await prisma.store.create({ data: { code: `TEST-REX-${token}`, name: "Toko Export", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `rex-admin-${token}@test.local`, name: "Admin Export", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `rex-collector-${token}@test.local`, name: "Kolektor Export", role: "ADMIN" } });
    collectorId = collector.id;
    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-REX-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-REX-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(Date.now() - 10 * 86400000), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(Date.now() - 10 * 86400000), originalAmount: 1000, outstandingAmount: 700, paidAmount: 300, status: "PARTIAL", collectorId } });
    receivableId = receivable.id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("exports a row matching the same filters listReceivables would use", async () => {
    const { rows, truncated, totalRows } = await listReceivablesForExport({ storeId });
    expect(rows).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(totalRows).toBe(1);
    const row = rows[0];
    expect(row.storeName).toBe("Toko Export");
    expect(row.docNo).toBe(`TEST-REX-DLV-${token}`);
    expect(row.outstandingAmount).toBe(700);
    expect(row.paidAmount).toBe(300);
    expect(row.status).toBe("PARTIAL");
    expect(row.collectorName).toBe("Kolektor Export");
    expect(row.daysOverdue).toBeGreaterThanOrEqual(9);
  });

  it("returns an empty result for a filter matching nothing, not an error", async () => {
    const { rows, totalRows } = await listReceivablesForExport({ storeId: "does-not-exist" });
    expect(rows).toHaveLength(0);
    expect(totalRows).toBe(0);
  });

  it("shows Belum ditugaskan-equivalent null, not a crash, for an unassigned receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { collectorId: null } });
    const { rows } = await listReceivablesForExport({ storeId });
    expect(rows[0].collectorName).toBeNull();
  });

  it("reports truncation and the true total when the row count exceeds the cap", async () => {
    const { rows, truncated, totalRows } = await listReceivablesForExport({ storeId }, { cap: 0 });
    expect(truncated).toBe(true);
    expect(totalRows).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it("does not report truncation when the row count is within the cap", async () => {
    const { truncated } = await listReceivablesForExport({ storeId }, { cap: 1 });
    expect(truncated).toBe(false);
  });
});
