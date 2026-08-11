import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { updateDeliveryDatesAction } from "./field-sales-deliveries";

/* Writes to real rows — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("updateDeliveryDatesAction (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let deliveryId = "";
  let docNo = "";

  const INVOICE = new Date("2026-04-01T00:00:00.000+07:00");
  const DUE = new Date("2026-05-01T00:00:00.000+07:00");

  beforeEach(async () => {
    uomId = ""; itemId = ""; storeId = ""; userId = ""; orderId = ""; lineId = ""; deliveryId = ""; docNo = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSDA-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSDA-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSDA-STORE-${token}`, name: "Test FSDA Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsda-${token}@example.com`, name: "Test FSDA Admin" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSDA-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 1000,
        total: 1000,
        lines: { create: [{ itemId, variantSku: "", productName: "Test FSDA Product", qty: 1, unitPrice: 1000, lineTotal: 1000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;

    docNo = `DLV/TEST-FSDA-${token}`;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo,
        orderId,
        deliveredAt: new Date(),
        deliveredById: userId,
        invoiceDate: INVOICE,
        dueDate: DUE,
        subtotal: 1000,
        discountAmount: 0,
        total: 1000,
        lines: { create: [{ orderLineId: lineId, itemId, variantSku: "", productName: "Test FSDA Product", qty: 1, unitPrice: 1000, discountAmount: 0, lineTotal: 1000 }] },
      },
    });
    deliveryId = delivery.id;

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["field_sales_orders:deliver"] } });
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(deliveryId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function currentDates() {
    const row = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    return { invoiceDate: row.invoiceDate.toISOString(), dueDate: row.dueDate.toISOString(), docNo: row.docNo };
  }

  it("refuses without the deliver permission and writes nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: [] } });

    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "correcting the tempo",
    });

    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await currentDates()).toMatchObject({ invoiceDate: INVOICE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("rejects an empty reason before writing anything", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "   ",
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await currentDates()).toMatchObject({ dueDate: DUE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("rejects a due date earlier than the invoice date", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-09",
      reason: "typo",
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_DATES" });
    expect(await currentDates()).toMatchObject({ dueDate: DUE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("stores both dates and writes one audit row carrying before, after and the reason", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "store agreed a shorter tempo",
    });

    expect(result).toEqual({ ok: true });

    const after = await currentDates();
    expect(after.invoiceDate).toBe(new Date("2026-04-10T00:00:00.000+07:00").toISOString());
    expect(after.dueDate).toBe(new Date("2026-04-20T00:00:00.000+07:00").toISOString());
    /* The document number is the one thing the client said must never move. */
    expect(after.docNo).toBe(docNo);

    const logs = await prisma.auditLog.findMany({ where: { entityId: seededId(deliveryId) } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("UPDATE_DELIVERY_DATES");
    expect(logs[0].entityType).toBe("FieldSalesDelivery");
    expect(logs[0].reason).toBe("store agreed a shorter tempo");
    expect(logs[0].changes).toMatchObject({
      before: { invoiceDate: INVOICE.toISOString(), dueDate: DUE.toISOString() },
      after: {
        invoiceDate: new Date("2026-04-10T00:00:00.000+07:00").toISOString(),
        dueDate: new Date("2026-04-20T00:00:00.000+07:00").toISOString(),
      },
    });
  });

  it("reports NOT_FOUND for an unknown delivery and writes no audit row", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId: "does-not-exist",
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "typo",
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { entityId: "does-not-exist" } })).toBe(0);
  });
});
