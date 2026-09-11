import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldSalesOrder } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/* Stubbed so the writer's post-commit fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { approveFieldSalesOrderAction, rejectFieldSalesOrderAction } from "@/app/actions/field-sales-orders";

d("field-sales order approve/reject actions (test bed only)", () => {
  const sku = `TEST-FSAA-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let orderId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: null, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    const { orderId: newOrderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "T", qty: 6, unitPrice: 35000 }],
    });
    orderId = newOrderId;

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: salesmanId, permissions: ["field_sales_orders:approve"] } });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId } });
    /**
     * createFieldSalesOrder writes one AdminNotification (PENDING_ORDER_APPROVAL, always) and
     * one more (CREDIT_LIMIT_HOLD, on the over-limit test) INSIDE its transaction — mocking
     * fanOutAdminNotification above only suppresses the FCM push, not the row. Neither carries an
     * FK back to FieldSalesOrder (just a Json metadata blob), so they'd leak into the shared
     * :3308 bed once the orders below are deleted. Prisma's JSON path filtering is unreliable on
     * this MariaDB adapter, so read the candidate rows and match orderId in JS against our own
     * seeded ids, same pattern as konsi-transfer/writer.test.ts.
     */
    const orderIds = (await prisma.fieldSalesOrder.findMany({ where: { storeId: seededId(storeId) }, select: { id: true } })).map((o) => o.id);
    if (orderIds.length > 0) {
      const candidateNotifs = await prisma.adminNotification.findMany({
        where: { category: { in: ["PENDING_ORDER_APPROVAL", "CREDIT_LIMIT_HOLD"] } },
        select: { id: true, metadata: true },
      });
      const leakedNotifIds = candidateNotifs
        .filter((n) => orderIds.includes((n.metadata as { orderId?: string } | null)?.orderId ?? ""))
        .map((n) => n.id);
      if (leakedNotifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: leakedNotifIds } } });
    }
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("approve as a permitted user sets APPROVED without consuming stock (moved to delivery)", async () => {
    const result = await approveFieldSalesOrderAction(orderId);
    expect(result).toEqual({ ok: true });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("APPROVED");

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(100);
    expect(Number(inv!.reservedQty)).toBe(6);
  });

  it("reject releases the reservation and sets REJECTED", async () => {
    const result = await rejectFieldSalesOrderAction(orderId, "out of stock");
    expect(result).toEqual({ ok: true });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("REJECTED");

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(0);
  });

  it("approve without the approve permission returns FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: salesmanId, permissions: [] } });
    const result = await approveFieldSalesOrderAction(orderId);
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("PENDING_APPROVAL");
  });

  it("re-approving an already-APPROVED order is idempotent", async () => {
    const first = await approveFieldSalesOrderAction(orderId);
    expect(first).toEqual({ ok: true });

    const second = await approveFieldSalesOrderAction(orderId);
    expect(second).toEqual({ ok: true });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("APPROVED");
  });

  it("approving a non-existent order returns NOT_FOUND", async () => {
    const result = await approveFieldSalesOrderAction("does-not-exist");
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("approve with finalPrices for an appealed line applies the final price via the writer", async () => {
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    await prisma.fieldSalesOrderLine.update({
      where: { id: line.id },
      data: { requestedUnitPrice: 30000, appealReason: "Nego harga" },
    });

    const result = await approveFieldSalesOrderAction(orderId, [{ lineId: line.id, finalUnitPrice: 30000 }]);
    expect(result).toEqual({ ok: true });

    const finalLine = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(finalLine.unitPrice)).toBe(30000);
    expect(Number(finalLine.lineTotal)).toBe(6 * 30000);

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("APPROVED");
    expect(Number(order!.total)).toBe(6 * 30000);
  });

  it.each([
    { finalUnitPrice: -1, label: "negative" },
    { finalUnitPrice: Number.NaN, label: "NaN" },
    { finalUnitPrice: Number.POSITIVE_INFINITY, label: "Infinity" },
  ])("approve rejects a $label finalUnitPrice with INVALID_FINAL_PRICE, order stays PENDING_APPROVAL", async ({ finalUnitPrice }) => {
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    const result = await approveFieldSalesOrderAction(orderId, [{ lineId: line.id, finalUnitPrice }]);
    expect(result).toEqual({ ok: false, reason: "INVALID_FINAL_PRICE" });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("PENDING_APPROVAL");
  });

  it("approve rejects a malformed finalPrices entry (missing lineId) with INVALID_FINAL_PRICE", async () => {
    const result = await approveFieldSalesOrderAction(
      orderId,
      // @ts-expect-error — intentionally malformed to exercise the runtime guard
      [{ finalUnitPrice: 1000 }],
    );
    expect(result).toEqual({ ok: false, reason: "INVALID_FINAL_PRICE" });
  });

  it("approve without a reason on an over-limit order returns CREDIT_LIMIT_EXCEEDED", async () => {
    await prisma.item.update({ where: { id: itemId }, data: { sellingPrice: 100_000 } });
    await prisma.store.update({ where: { id: storeId }, data: { creditLimit: 100_000 } });
    const { orderId: overOrderId } = await (await import("./writer")).createFieldSalesOrder({
      storeId, salesmanId, visitId, lines: [{ itemId, variantSku: "", productName: "T", qty: 6, unitPrice: 100_000 }],
    });
    const result = await approveFieldSalesOrderAction(overOrderId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CREDIT_LIMIT_EXCEEDED");
      expect(result.credit?.creditLimit).toBe(100_000);
    }
  });
});
