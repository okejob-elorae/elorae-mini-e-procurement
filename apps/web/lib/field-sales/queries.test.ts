import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeListItem, listFieldSalesOrders, getFieldSalesOrderById, sentItemIds, getStoreSentItems } from "./queries";
import { createFieldSalesOrder } from "./writer";
import { Prisma, prisma, seededId } from "@elorae/db";

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

  it("getFieldSalesOrderById resolves a konsiTransfer line's human variant label from Item.variants, not the raw SKU", async () => {
    const item2 = await prisma.item.create({
      data: {
        sku: `${sku}-VAR`,
        nameId: "Kaos Polos",
        nameEn: "Plain Shirt",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 35000,
        variants: [{ sku: "27000101P-BLK-XL", color: "Hitam", size: "XL" }],
      },
    });
    itemId2 = item2.id;
    await prisma.inventoryValue.create({ data: { itemId: itemId2, variantSku: "27000101P-BLK-XL", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });

    const order = await seedOrder({ orderType: "KONSI", forItemId: itemId2 });
    const transfer = await prisma.konsiTransfer.create({
      data: {
        docNo: `KONSITRF/TEST/${Math.random().toString(36).slice(2, 10)}`,
        orderId: order.id,
        storeId,
        transferredById: salesmanId,
        lines: {
          create: [{ itemId: itemId2, variantSku: "27000101P-BLK-XL", productName: "Kaos Polos", qty: 1, unitCost: 1000 }],
        },
      },
    });

    const detail = await getFieldSalesOrderById(order.id);
    expect(detail!.konsiTransfer).not.toBeNull();
    expect(detail!.konsiTransfer!.lines).toHaveLength(1);
    expect(detail!.konsiTransfer!.lines[0].variantSku).toBe("27000101P-BLK-XL");
    expect(detail!.konsiTransfer!.lines[0].variantLabel).toBe("color: Hitam · size: XL");

    await prisma.konsiTransferLine.deleteMany({ where: { transferId: transfer.id } });
    await prisma.konsiTransfer.deleteMany({ where: { id: transfer.id } });
  });

  it("getFieldSalesOrderById exposes addedById per line so the admin-added badge has something to read", async () => {
    /*
     * The writer specs assert addedById straight off the row via Prisma, which stays green even if
     * the detail query stops selecting it — and the provenance badge would silently disappear.
     * This asserts the passthrough itself.
     */
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId,
        salesmanId,
        visitId,
        status: "PENDING_APPROVAL",
        orderType: "KONSI",
        subtotal: 0,
        total: 0,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "T", qty: 1, unitPrice: 0, lineTotal: 0 },
            { itemId, variantSku: "ADDED", productName: "T added", qty: 2, unitPrice: 0, lineTotal: 0, addedById: salesmanId },
          ],
        },
      },
    });

    const detail = await getFieldSalesOrderById(order.id);
    const salesmanLine = detail!.lines.find((l) => l.variantSku === "")!;
    const addedLine = detail!.lines.find((l) => l.variantSku === "ADDED")!;
    expect(salesmanLine.addedById).toBeNull();
    expect(addedLine.addedById).toBe(salesmanId);
  });
});

d("getStoreSentItems (test bed only)", () => {
  const sku = `TEST-FSQ-SENT-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "Kaos Test", nameEn: "Test Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "M", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "L", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "KONSI", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId: seededId(storeId) } } });
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

  const seedOrder = async (opts: {
    orderType: "PUTUS" | "KONSI";
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    lines: Array<{ variantSku: string; qty: number }>;
  }) => {
    return prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${opts.orderType}/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId,
        salesmanId,
        visitId,
        status: opts.status,
        orderType: opts.orderType,
        subtotal: 0,
        total: 0,
        lines: {
          create: opts.lines.map((l) => ({
            itemId, variantSku: l.variantSku, productName: "Kaos Test", qty: l.qty, unitPrice: 0, lineTotal: 0,
          })),
        },
      },
      include: { lines: true },
    });
  };

  /* Records what shipped against an order, one delivery line per order line at the given qty. */
  const seedDelivery = async (
    order: { id: string; lines: Array<{ id: string; itemId: string; variantSku: string }> },
    shipped: Array<{ variantSku: string; qty: number }>,
  ) => {
    return prisma.fieldSalesDelivery.create({
      data: {
        docNo: `DLV/TEST/${Math.random().toString(36).slice(2, 10)}`,
        orderId: order.id,
        deliveredAt: new Date(),
        deliveredById: salesmanId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 0,
        total: 0,
        lines: {
          create: shipped.map((s) => ({
            orderLineId: order.lines.find((l) => l.variantSku === s.variantSku)!.id,
            itemId,
            variantSku: s.variantSku,
            productName: "Kaos Test",
            qty: s.qty,
          })),
        },
      },
    });
  };

  it("counts putus by what was delivered, not what was approved, and konsi by its approved lines", async () => {
    /* Putus ordered 3 M + 2 L but only 1 M ever shipped — the other 4 units never left the warehouse. */
    const putus = await seedOrder({ orderType: "PUTUS", status: "APPROVED", lines: [{ variantSku: "M", qty: 3 }, { variantSku: "L", qty: 2 }] });
    await seedDelivery(putus, [{ variantSku: "M", qty: 1 }]);
    await seedOrder({ orderType: "KONSI", status: "APPROVED", lines: [{ variantSku: "M", qty: 4 }] });
    await seedOrder({ orderType: "PUTUS", status: "REJECTED", lines: [{ variantSku: "M", qty: 100 }] });
    await seedOrder({ orderType: "KONSI", status: "PENDING_APPROVAL", lines: [{ variantSku: "L", qty: 50 }] });

    const rows = await getStoreSentItems(storeId);
    expect(rows).toHaveLength(1);

    const bySize = new Map(rows.map((r) => [r.variantSku, r]));
    expect(bySize.get("M")?.totalQty).toBe(5); // 1 delivered (putus) + 4 (konsi), excludes rejected 100
    expect(bySize.has("L")).toBe(false); // approved but never delivered, and the pending konsi 50 is excluded
    for (const r of rows) {
      expect(r.itemId).toBe(itemId);
      expect(r.articleSku).toBe(sku);
      expect(r.articleName).toBe("Kaos Test");
    }
  });

  it("sums repeat deliveries of the same article+variant", async () => {
    const putus = await seedOrder({ orderType: "PUTUS", status: "APPROVED", lines: [{ variantSku: "M", qty: 3 }] });
    await seedDelivery(putus, [{ variantSku: "M", qty: 1 }]);
    await seedDelivery(putus, [{ variantSku: "M", qty: 2 }]);

    const rows = await getStoreSentItems(storeId);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalQty).toBe(3);
  });

  it("returns empty array when the store has nothing delivered and no approved konsi", async () => {
    await seedOrder({ orderType: "PUTUS", status: "PENDING_APPROVAL", lines: [{ variantSku: "M", qty: 5 }] });
    await seedOrder({ orderType: "PUTUS", status: "APPROVED", lines: [{ variantSku: "L", qty: 5 }] });
    const rows = await getStoreSentItems(storeId);
    expect(rows).toEqual([]);
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
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100, minOrderQty: 1 },
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

  it("getFieldSalesOrderById exposes requestedUnitPrice/appealReason for an appealed line, null for a plain line", async () => {
    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "X", qty: 2, unitPrice: 100, requestedUnitPrice: 80, appealReason: "Nego harga" }],
    });

    const detail = await getFieldSalesOrderById(orderId);
    expect(detail!.lines[0].requestedUnitPrice).toBe(80);
    expect(detail!.lines[0].appealReason).toBe("Nego harga");

    const { orderId: plainOrderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "X", qty: 2, unitPrice: 100 }],
    });
    const plainDetail = await getFieldSalesOrderById(plainOrderId);
    expect(plainDetail!.lines[0].requestedUnitPrice).toBeNull();
    expect(plainDetail!.lines[0].appealReason).toBeNull();
  });
});
