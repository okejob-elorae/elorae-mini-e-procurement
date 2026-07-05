import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeListItem, listFieldSalesOrders, getFieldSalesOrderById, sentItemIds } from "./queries";
import { createFieldSalesOrder } from "./writer";
import { Prisma, prisma } from "@elorae/db";

describe("serializeListItem", () => {
  it("flattens relations + coerces Decimal total to number", () => {
    const row = {
      id: "o1",
      orderNo: "PUTUS/2026/0001",
      orderType: "PUTUS" as const,
      status: "PENDING_APPROVAL" as const,
      total: new Prisma.Decimal("210000.00"),
      createdAt: new Date("2026-07-04T00:00:00Z"),
      store: { name: "Toko A" },
      salesman: { name: "Budi" },
    };
    expect(serializeListItem(row)).toEqual({
      id: "o1",
      orderNo: "PUTUS/2026/0001",
      orderType: "PUTUS",
      storeName: "Toko A",
      salesmanName: "Budi",
      status: "PENDING_APPROVAL",
      total: 210000,
      createdAt: new Date("2026-07-04T00:00:00Z"),
    });
  });
  it("falls back when salesman name is null", () => {
    const row = {
      id: "o2", orderNo: "PUTUS/2026/0002", orderType: "PUTUS" as const, status: "APPROVED" as const,
      total: new Prisma.Decimal("0"), createdAt: new Date("2026-07-04T00:00:00Z"),
      store: { name: "Toko B" }, salesman: { name: null },
    };
    expect(serializeListItem(row).salesmanName).toBe("—");
  });
  it("passes orderType through for a konsi row", () => {
    const row = {
      id: "o3", orderNo: "KONSI/2026/0001", orderType: "KONSI" as const, status: "PENDING_APPROVAL" as const,
      total: new Prisma.Decimal("0"), createdAt: new Date("2026-07-04T00:00:00Z"),
      store: { name: "Toko C" }, salesman: { name: "Budi" },
    };
    expect(serializeListItem(row).orderType).toBe("KONSI");
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("konsi queries (test bed only)", () => {
  const sku = `TEST-FSQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let itemId2 = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    itemId2 = "";
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 20, reservedQty: 5, avgCost: 1000, totalValue: 20000 } });
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

  const seedOrder = async (opts: { orderType: "PUTUS" | "KONSI"; status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"; forItemId?: string }) => {
    const lineItemId = opts.forItemId ?? itemId;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${opts.orderType}/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId,
        salesmanId,
        visitId,
        status: opts.status ?? "PENDING_APPROVAL",
        orderType: opts.orderType,
        subtotal: 0,
        total: 0,
        lines: {
          create: [{ itemId: lineItemId, variantSku: "", productName: "T", qty: 1, unitPrice: 0, lineTotal: 0 }],
        },
      },
    });
    return order;
  };

  it("listFieldSalesOrders filters by orderType and returns orderType on items", async () => {
    const putus = await seedOrder({ orderType: "PUTUS" });
    const konsi = await seedOrder({ orderType: "KONSI" });

    const res = await listFieldSalesOrders({ orderType: "KONSI" }, { page: 1, pageSize: 50 });
    expect(res.orders.every((o) => o.orderType === "KONSI")).toBe(true);
    expect(res.orders.map((o) => o.id)).toContain(konsi.id);
    expect(res.orders.map((o) => o.id)).not.toContain(putus.id);
  });

  it("sentItemIds includes items on non-rejected konsi lines, excludes rejected-only items", async () => {
    const item2 = await prisma.item.create({ data: { sku: `${sku}-B`, nameId: "T2", nameEn: "T2", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId2 = item2.id;
    await prisma.inventoryValue.create({ data: { itemId: itemId2, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });

    await seedOrder({ orderType: "KONSI", status: "PENDING_APPROVAL", forItemId: itemId });
    await seedOrder({ orderType: "KONSI", status: "REJECTED", forItemId: itemId2 });

    const sent = await sentItemIds(storeId);
    expect(sent.has(itemId)).toBe(true);
    expect(sent.has(itemId2)).toBe(false);
  });

  it("getFieldSalesOrderById computes available per line as qtyOnHand - reservedQty", async () => {
    const order = await seedOrder({ orderType: "KONSI" });

    const detail = await getFieldSalesOrderById(order.id);
    expect(detail).not.toBeNull();
    expect(detail!.orderType).toBe("KONSI");
    expect(detail!.lines).toHaveLength(1);
    expect(detail!.lines[0].available).toBe(15); // qtyOnHand 20 - reservedQty 5
  });
});

d("putus detail with promo (test bed only)", () => {
  const sku = `TEST-FSQ-PUTUS-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let promoId = "";

  beforeEach(async () => {
    promoId = "";
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000, minOrderQty: 1 },
    });
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

  it("getFieldSalesOrderById exposes discountAmount, appliedPromoName, and order discount fields", async () => {
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

    const detail = await getFieldSalesOrderById(orderId);
    expect(detail).not.toBeNull();
    expect(detail!.lines).toHaveLength(1);
    expect(detail!.lines[0].discountAmount).toBe(20);
    expect(detail!.lines[0].appliedPromoName).toBe(promo.name);
    expect(detail!.lines[0].belowCost).toBe(true); // net unit 90 < avgCost 1000
    expect(detail!.orderDiscountAmount).toBe(0);
    expect(detail!.appliedOrderPromoName).toBeNull();
  });
});
