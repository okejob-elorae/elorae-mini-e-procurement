import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listDeliveryShipments, getDeliveryShipment, listMyDeliveries } from "./shipment-queries";
import { createDeliveryShipment, updateShipmentTracking, shipDeliveryShipment } from "./shipment-writer";

describe("shipment-queries", () => {
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let itemId = "";
  let shipmentId = "";

  beforeEach(async () => {
    storeId = userId = orderId = lineId = itemId = shipmentId = "";
    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Query Store", address: "x", termsType: "PUTUS" },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `QSKU-${Date.now()}`, nameId: "Query Item", nameEn: "Query Item", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `QFSO-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 40000,
        total: 40000,
        lines: { create: [{ itemId, productName: "Query Item", qty: 4, unitPrice: 10000, lineTotal: 40000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
    const created = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: lineId, qty: 4 }],
      packedById: userId,
    });
    shipmentId = created.shipmentId;
  });

  afterEach(async () => {
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: seededId(shipmentId) } });
    await prisma.deliveryShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("lists shipments filtered by status", async () => {
    const result = await listDeliveryShipments({ status: "PACKED", page: 1, pageSize: 20 });
    expect(result.items.some((i) => i.id === shipmentId)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);

    const empty = await listDeliveryShipments({ status: "DELIVERED", storeId, page: 1, pageSize: 20 });
    expect(empty.items.some((i) => i.id === shipmentId)).toBe(false);
  });

  it("gets a shipment with its lines", async () => {
    const detail = await getDeliveryShipment(shipmentId);
    expect(detail?.docNo).toMatch(/^DLV\//);
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0].plannedQty).toBe(4);
  });

  it("returns null for a missing shipment", async () => {
    const detail = await getDeliveryShipment("does-not-exist");
    expect(detail).toBeNull();
  });

  it("lists only IN_TRANSIT shipments carried by the given user", async () => {
    await updateShipmentTracking({
      shipmentId,
      carriedById: userId,
      resiNumber: "RESI-TEST",
      invoiceDate: new Date("2026-09-10T00:00:00.000Z"),
      dueDate: new Date("2026-09-20T00:00:00.000Z"),
    });
    /* shipmentId from this describe's beforeEach is still PACKED (never shipped in this
       describe) — ship it here so it qualifies for the IN_TRANSIT filter. */
    await shipDeliveryShipment({ shipmentId, shippedById: userId });

    const mine = await listMyDeliveries(userId);
    expect(mine.some((m) => m.id === shipmentId)).toBe(true);

    const someoneElsesId = "does-not-exist-as-a-carrier";
    const notMine = await listMyDeliveries(someoneElsesId);
    expect(notMine.some((m) => m.id === shipmentId)).toBe(false);
  });
});
