import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { sumPendingClaimsOnReceivable } from "./pending-claims";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("sumPendingClaimsOnReceivable (test bed only)", () => {
  let token = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; orderId = ""; deliveryId = ""; receivableId = "";

    const store = await prisma.store.create({ data: { code: `TEST-PCL-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const user = await prisma.user.create({ data: { email: `pcl-${token}@test.local`, name: "test", role: "ADMIN" } });
    userId = user.id;
    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-PCL-ORD-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-PCL-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000, collectorId: userId } });
    receivableId = receivable.id;

    const submission = (amount: number, status: "PENDING" | "VERIFIED") =>
      prisma.collectionSubmission.create({
        data: { receivableId, collectorId: userId, amount, method: "CASH", paidAt: new Date(), status },
      });
    await submission(300, "PENDING");
    await submission(999, "VERIFIED");

    const settlement = (label: string, amount: number, status: "PENDING" | "REJECTED") =>
      prisma.storeSettlement.create({
        data: {
          docNo: `TEST-PCL-STL-${label}-${token}`,
          storeId,
          salesmanId: userId,
          expectedAmount: amount,
          actualAmount: amount,
          varianceAmount: 0,
          status,
          invoices: { create: [{ receivableId, amount }] },
        },
      });
    await settlement("P", 200, "PENDING");
    await settlement("R", 999, "REJECTED");
  });

  afterEach(async () => {
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(receivableId) } });
    await prisma.storeSettlementInvoice.deleteMany({ where: { receivableId: seededId(receivableId) } });
    await prisma.storeSettlement.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("sums only PENDING claims of both kinds", async () => {
    const claims = await prisma.$transaction(async (tx) =>
      sumPendingClaimsOnReceivable(tx, { receivableId, storeId }),
    );
    expect(claims).toEqual({ collections: 300, settlements: 200, total: 500 });
  });

  it("returns zeros for a receivable with no claims", async () => {
    const claims = await prisma.$transaction(async (tx) =>
      sumPendingClaimsOnReceivable(tx, { receivableId: `missing-${token}`, storeId }),
    );
    expect(claims).toEqual({ collections: 0, settlements: 0, total: 0 });
  });
});
