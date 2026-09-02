import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listOffsettableReturns, getStoreAvailableCredit, suggestOffsetAllocations } from "./retur-offset-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("retur-offset-queries (test bed only)", () => {
  let token = "";
  let storeId = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let orderId = "";
  let orderLineId = "";
  let deliveryId = "";
  let deliveryLineId = "";
  let receivableId = "";
  let returAvailableId = "";
  let returAppliedId = "";
  let returPendingValId = "";
  let returPendingApprovalId = "";
  let returManualPricedId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; uomId = ""; itemId = ""; orderId = ""; orderLineId = ""; deliveryId = ""; deliveryLineId = "";
    receivableId = ""; returAvailableId = ""; returAppliedId = ""; returPendingValId = "";
    returPendingApprovalId = ""; returManualPricedId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-ROQ-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({
      data: { email: `roq-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;
    const uom = await prisma.uOM.create({ data: { code: `TEST-ROQ-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-ROQ-ITEM-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ROQ-ORD-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderId = order.id;
    const orderLine = await prisma.fieldSalesOrderLine.create({
      data: { orderId, itemId, productName: "t", qty: 10, unitPrice: 100, lineTotal: 1000 },
    });
    orderLineId = orderLine.id;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROQ-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 1000, total: 1000,
      },
    });
    deliveryId = delivery.id;
    const deliveryLine = await prisma.fieldSalesDeliveryLine.create({
      data: { deliveryId, orderLineId, itemId, productName: "t", qty: 10, lineTotal: 1000 },
    });
    deliveryLineId = deliveryLine.id;
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 1000, outstandingAmount: 1000,
      },
    });
    receivableId = receivable.id;

    const mkReturn = async (
      status: "PENDING_APPROVAL" | "APPROVED",
      valuationStatus: "PENDING" | "VALUED",
      offsetStatus: "AVAILABLE" | "APPLIED",
      totalValue: number | null,
      priceDeliveryLineId: string | null,
      priceSource: "DELIVERY" | "MANUAL" | null,
    ) => {
      const ret = await prisma.fieldReturn.create({
        data: {
          docNo: `TEST-ROQ-RET-${token}-${Math.random().toString(36).slice(2, 6)}`,
          storeId, raisedById: userId, status, valuationStatus, offsetStatus,
          totalValue, approvedAt: status === "APPROVED" ? new Date() : null, approvedById: status === "APPROVED" ? userId : null,
        },
      });
      await prisma.fieldReturnLine.create({
        data: {
          returnId: ret.id, itemId, qty: 5, reason: "UNSOLD",
          lineValue: totalValue, unitPrice: totalValue ? totalValue / 5 : null,
          priceSource, priceDeliveryLineId,
        },
      });
      return ret.id;
    };

    returAvailableId = await mkReturn("APPROVED", "VALUED", "AVAILABLE", 300, deliveryLineId, "DELIVERY");
    returAppliedId = await mkReturn("APPROVED", "VALUED", "APPLIED", 400, null, "MANUAL");
    returPendingValId = await mkReturn("APPROVED", "PENDING", "AVAILABLE", null, null, null);
    returPendingApprovalId = await mkReturn("PENDING_APPROVAL", "PENDING", "AVAILABLE", null, null, null);
    returManualPricedId = await mkReturn("APPROVED", "VALUED", "AVAILABLE", 250, null, "MANUAL");
  });

  afterEach(async () => {
    const returnIds = [
      seededId(returAvailableId), seededId(returAppliedId), seededId(returPendingValId),
      seededId(returPendingApprovalId), seededId(returManualPricedId),
    ];
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { id: seededId(deliveryLineId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { id: seededId(orderLineId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("listOffsettableReturns returns only APPROVED + VALUED + AVAILABLE returns", async () => {
    const { rows, total } = await listOffsettableReturns({ storeId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(returAvailableId);
    expect(ids).toContain(returManualPricedId);
    expect(ids).not.toContain(returAppliedId);
    expect(ids).not.toContain(returPendingValId);
    expect(ids).not.toContain(returPendingApprovalId);
    expect(total).toBe(2);
  });

  it("getStoreAvailableCredit sums only offsettable returns for that store", async () => {
    const credit = await getStoreAvailableCredit(storeId);
    expect(credit).toBe(550);
  });

  it("suggestOffsetAllocations resolves the priced-from receivable at its outstanding, capped", async () => {
    const suggestion = await suggestOffsetAllocations(returAvailableId);
    expect(suggestion).toEqual([{ receivableId, amount: 300 }]);
  });

  it("suggestOffsetAllocations returns [] for a MANUAL-priced return with no delivery provenance", async () => {
    const suggestion = await suggestOffsetAllocations(returManualPricedId);
    expect(suggestion).toEqual([]);
  });

  it("suggestOffsetAllocations returns [] for a dangling priceDeliveryLineId", async () => {
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { id: deliveryLineId } });
    const suggestion = await suggestOffsetAllocations(returAvailableId);
    expect(suggestion).toEqual([]);
    /* Re-create so afterEach's own teardown of deliveryLineId is a no-op, not a dangling id it never seeded. */
    const recreated = await prisma.fieldSalesDeliveryLine.create({
      data: { id: deliveryLineId, deliveryId, orderLineId, itemId, productName: "t", qty: 10, lineTotal: 1000 },
    });
    deliveryLineId = recreated.id;
  });
});
