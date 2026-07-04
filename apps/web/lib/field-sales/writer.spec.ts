import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder, rejectFieldSalesOrder } from "./writer";
import { NoActiveVisitError, MinQtyViolationError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("field-sales lifecycle writers (test bed only)", () => {
  const sku = `TEST-FSW-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  const line = () => ({ itemId, variantSku: "", productName: "T", qty: 6, unitPrice: 35000 });

  it("create reserves stock, sets PENDING_APPROVAL, notifies admin", async () => {
    const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [line()] });
    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: res.orderId }, include: { lines: true } });
    expect(order!.status).toBe("PENDING_APPROVAL");
    expect(order!.lines).toHaveLength(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(Number(inv!.reservedQty)).toBe(6);
    const notif = await prisma.adminNotification.findFirst({ where: { category: "PENDING_ORDER_APPROVAL", message: { contains: order!.orderNo } } });
    expect(notif).not.toBeNull();
  });

  it("create throws when qty below minimum (default 6)", async () => {
    await expect(createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [{ ...line(), qty: 3 }] }))
      .rejects.toBeInstanceOf(MinQtyViolationError);
  });

  it("create throws without an active visit", async () => {
    await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
    await expect(createFieldSalesOrder({ storeId, salesmanId, lines: [line()] }))
      .rejects.toBeInstanceOf(NoActiveVisitError);
  });

  it("approve consumes stock and writes OFFLINE SalesHistory rows", async () => {
    const { orderId, orderNo } = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [line()] });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(Number(inv!.qtyOnHand)).toBe(94);
    expect(Number(inv!.reservedQty)).toBe(0);
    const hist = await prisma.salesHistory.findMany({ where: { orderId: orderNo } });
    expect(hist).toHaveLength(1);
    expect(hist[0].channel).toBe("OFFLINE");
    expect(hist[0].orderStatus).toBe("COMPLETED");
    expect(hist[0].importBatchId).toBeNull();
  });

  it("reject releases the hold", async () => {
    const { orderId } = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [line()] });
    await rejectFieldSalesOrder({ orderId, rejectedById: salesmanId, reason: "no" });
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(Number(inv!.reservedQty)).toBe(0);
    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("REJECTED");
  });
});
