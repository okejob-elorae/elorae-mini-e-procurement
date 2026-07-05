import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder, rejectFieldSalesOrder } from "./writer";
import { NoActiveVisitError, MinQtyViolationError, InsufficientStockError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("field-sales lifecycle writers (test bed only)", () => {
  const sku = `TEST-FSW-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let itemId2 = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let promoId = "";

  beforeEach(async () => {
    itemId2 = "";
    promoId = "";
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
    if (promoId) await prisma.promo.deleteMany({ where: { id: promoId } });
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId } });
    if (itemId2) {
      await prisma.salesHistory.deleteMany({ where: { itemId: itemId2 } });
      await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId: itemId2 } });
    }
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    if (itemId2) {
      await prisma.stockReservation.deleteMany({ where: { itemId: itemId2 } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: itemId2 } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: itemId2 } });
      await prisma.item.deleteMany({ where: { id: itemId2 } });
    }
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

  it("approve of a 2-line order (two distinct non-variant items) writes 2 SalesHistory rows", async () => {
    const sku2 = `${sku}-B`;
    const item2 = await prisma.item.create({ data: { sku: sku2, nameId: "T2", nameEn: "T2", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 } });
    itemId2 = item2.id;
    await prisma.inventoryValue.create({ data: { itemId: itemId2, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });

    const { orderId, orderNo } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [line(), { itemId: itemId2, variantSku: "", productName: "T2", qty: 6, unitPrice: 40000 }],
    });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });

    const hist = await prisma.salesHistory.findMany({ where: { orderId: orderNo } });
    expect(hist).toHaveLength(2);
    expect(hist.map((h) => h.variantSku).sort()).toEqual([sku, sku2].sort());
    expect(hist.every((h) => h.channel === "OFFLINE" && h.orderStatus === "COMPLETED")).toBe(true);
  });

  it("reject releases the hold", async () => {
    const { orderId } = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [line()] });
    await rejectFieldSalesOrder({ orderId, rejectedById: salesmanId, reason: "no" });
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(Number(inv!.reservedQty)).toBe(0);
    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("REJECTED");
  });

  it("putus create applies an active line promo → discountAmount persisted, total is net", async () => {
    await prisma.item.update({ where: { id: itemId }, data: { minOrderQty: 1 } });
    const promo = await prisma.promo.create({
      data: {
        name: `TEST-PROMO-${sku}`,
        type: "PERCENT",
        level: "LINE",
        termsType: "PUTUS",
        value: 10,
        allStores: true,
        isActive: true,
        items: { create: [{ itemId }] },
      },
    });
    promoId = promo.id;

    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "X", qty: 2, unitPrice: 100 }],
    });
    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });

    expect(Number(order!.lines[0].discountAmount)).toBe(20);
    expect(order!.lines[0].appliedPromoId).toBe(promo.id);
    expect(Number(order!.subtotal)).toBe(200);
    expect(Number(order!.total)).toBe(180);
  });
});

d("createFieldSalesOrder — konsi", () => {
  const sku = `TEST-FSW-KONSI-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000, minOrderQty: 6 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "KONSI", isActive: true } });
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

  it("creates a KONSI order with zero money, no reservation, no min-qty gate", async () => {
    const { orderId, orderNo } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "T", qty: 1, unitPrice: 35000 }],
    });

    expect(orderNo).toMatch(/^KONSI\//);
    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    expect(order!.orderType).toBe("KONSI");
    expect(Number(order!.total)).toBe(0);
    expect(order!.lines).toHaveLength(1);
    expect(Number(order!.lines[0].unitPrice)).toBe(0);

    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: order!.lines[0].id } });
    expect(rsv).toBeNull();

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(0);
  });
});

d("approveFieldSalesOrder — konsi", () => {
  const sku = `TEST-FSW-KONSI-APPR-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  const seedItemWithStock = async (qtyOnHand: number, sellingPrice: number) => {
    const item = await prisma.item.create({
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand, reservedQty: 0, avgCost: 1000, totalValue: qtyOnHand * 1000 } });
    return itemId;
  };

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const store = await prisma.store.create({
      data: { code: `S-${sku}`, name: "T", address: "T", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
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

  it("reserves (not consumes), stores gross-up, writes NO SalesHistory", async () => {
    await seedItemWithStock(10, 10000);
    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "X", qty: 4, unitPrice: 0 }],
    });
    const before = await prisma.salesHistory.count();

    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    expect(order!.status).toBe("APPROVED");
    // gross-up: 10000 / (1 - 0.20) = 12500
    expect(Number(order!.lines[0].unitPrice)).toBe(12500);
    expect(Number(order!.lines[0].lineTotal)).toBe(50000);
    expect(Number(order!.total)).toBe(50000);
    // reserved, NOT consumed
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(4);
    expect(Number(inv!.qtyOnHand)).toBe(10); // unchanged — no consume
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: order!.lines[0].id } });
    expect(rsv!.source).toBe("FIELD_SALES_KONSI");
    expect(rsv!.state).toBe("RESERVED");
    // NO SalesHistory written
    expect(await prisma.salesHistory.count()).toBe(before);
  });

  it("throws InsufficientStockError when a line exceeds available", async () => {
    await seedItemWithStock(2, 10000);
    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "X", qty: 5, unitPrice: 0 }],
    });

    await expect(approveFieldSalesOrder({ orderId, approvedById: salesmanId })).rejects.toBeInstanceOf(InsufficientStockError);

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe("PENDING_APPROVAL"); // not flipped
  });
});
