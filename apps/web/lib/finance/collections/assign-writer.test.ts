import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { assignCollector } from "./assign-writer";
import { CollectionError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("assignCollector (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let ineligibleUserId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";
  let settledDeliveryId = "";
  let settledReceivableId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = ""; ineligibleUserId = "";
    orderId = ""; deliveryId = ""; receivableId = "";
    settledDeliveryId = ""; settledReceivableId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-CAW-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const admin = await prisma.user.create({ data: { email: `caw-admin-${token}@test.local`, name: "admin", role: "USER" } });
    adminId = admin.id;

    const role = await prisma.roleDefinition.create({
      data: {
        name: `TEST-CAW-COLLECTOR-${token}`,
        isSystem: false,
        permissions: {
          create: [{ permission: { connectOrCreate: { where: { code: "collections:collect" }, create: { code: "collections:collect", module: "collections", action: "collect" } } } }],
        },
      },
    });
    const collector = await prisma.user.create({ data: { email: `caw-collector-${token}@test.local`, name: "collector", role: "USER", roleId: role.id } });
    collectorId = collector.id;

    const ineligible = await prisma.user.create({ data: { email: `caw-ineligible-${token}@test.local`, name: "ineligible", role: "USER" } });
    ineligibleUserId = ineligible.id;

    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CAW-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 },
    });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: { docNo: `TEST-CAW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 },
    });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({
      data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000 },
    });
    receivableId = receivable.id;

    const settledOrder = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CAW-ORD2-${token}`, storeId, salesmanId: adminId, subtotal: 500, total: 500 },
    });
    const settledDelivery = await prisma.fieldSalesDelivery.create({
      data: { docNo: `TEST-CAW-DLV2-${token}`, orderId: settledOrder.id, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 500, total: 500 },
    });
    settledDeliveryId = settledDelivery.id;
    const settledReceivable = await prisma.receivable.create({
      data: { deliveryId: settledDeliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 500, outstandingAmount: 0, status: "PAID" },
    });
    settledReceivableId = settledReceivable.id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { id: { in: [seededId(receivableId), seededId(settledReceivableId)] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(settledDeliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(adminId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(collectorId), seededId(ineligibleUserId), seededId(adminId)] } } });
    await prisma.roleDefinition.deleteMany({ where: { name: { startsWith: `TEST-CAW-COLLECTOR-${token}` } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("assigns an eligible collector to a receivable", async () => {
    await assignCollector({ receivableIds: [receivableId], collectorId, assignedById: adminId });
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(r!.collectorId).toBe(collectorId);
    const log = await prisma.auditLog.findFirst({ where: { entityType: "Receivable", entityId: receivableId, action: "COLLECTOR_ASSIGN" } });
    expect(log).not.toBeNull();
  });

  it("rejects a collector who does not hold collections:collect", async () => {
    await expect(assignCollector({ receivableIds: [receivableId], collectorId: ineligibleUserId, assignedById: adminId }))
      .rejects.toBeInstanceOf(CollectionError);
  });

  it("rejects a PAID receivable from the target list", async () => {
    await expect(assignCollector({ receivableIds: [settledReceivableId], collectorId, assignedById: adminId }))
      .rejects.toBeInstanceOf(CollectionError);
    const r = await prisma.receivable.findUnique({ where: { id: settledReceivableId } });
    expect(r!.collectorId).toBeNull();
  });

  it("unassigns with collectorId: null and no eligibility check", async () => {
    await assignCollector({ receivableIds: [receivableId], collectorId, assignedById: adminId });
    await assignCollector({ receivableIds: [receivableId], collectorId: null, assignedById: adminId });
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(r!.collectorId).toBeNull();
  });

  it("rejects an empty receivableIds list", async () => {
    await expect(assignCollector({ receivableIds: [], collectorId, assignedById: adminId }))
      .rejects.toBeInstanceOf(CollectionError);
  });
});
