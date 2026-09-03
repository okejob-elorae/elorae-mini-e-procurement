import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createDeliveryShipment, updateShipmentTracking, shipDeliveryShipment } from "./shipment-writer";
import { DeliveryShipmentError } from "./errors";

describe("createDeliveryShipment", () => {
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let itemId = "";
  let shipmentId = "";

  beforeEach(async () => {
    storeId = "";
    userId = "";
    orderId = "";
    lineId = "";
    itemId = "";
    shipmentId = "";

    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Test Store", address: "x", termsType: "PUTUS" },
    });
    storeId = store.id;

    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;

    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU-${Date.now()}`, nameId: "Test Item", nameEn: "Test Item", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 100000,
        total: 100000,
        lines: {
          create: [
            { itemId, productName: "Test Item", qty: 10, unitPrice: 10000, lineTotal: 100000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
  });

  afterEach(async () => {
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: seededId(shipmentId) } });
    await prisma.deliveryShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    await prisma.fieldSalesOrderLine.delete({ where: { id: seededId(lineId) } });
    await prisma.fieldSalesOrder.delete({ where: { id: seededId(orderId) } });
    await prisma.item.delete({ where: { id: seededId(itemId) } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
  });

  it("creates a PACKED shipment with its lines", async () => {
    const result = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: lineId, qty: 4 }],
      packedById: userId,
    });
    shipmentId = result.shipmentId;

    const shipment = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      include: { lines: true },
    });
    expect(shipment?.status).toBe("PACKED");
    expect(shipment?.method).toBe("EXPEDITION");
    expect(shipment?.lines).toHaveLength(1);
    expect(shipment?.lines[0].plannedQty).toBe(4);
    expect(result.docNo).toMatch(/^DLV\//);
  });

  it("refuses an empty line list", async () => {
    await expect(
      createDeliveryShipment({ orderId, method: "EXPEDITION", lines: [], packedById: userId }),
    ).rejects.toThrow(DeliveryShipmentError);
  });

  it("refuses a qty above the order line's remaining quantity", async () => {
    await expect(
      createDeliveryShipment({
        orderId,
        method: "EXPEDITION",
        lines: [{ orderLineId: lineId, qty: 999 }],
        packedById: userId,
      }),
    ).rejects.toMatchObject({ code: "OVER_PLANNED" });
  });
});

describe("updateShipmentTracking + shipDeliveryShipment", () => {
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let itemId = "";
  let shipmentId = "";

  beforeEach(async () => {
    storeId = "";
    userId = "";
    orderId = "";
    lineId = "";
    itemId = "";
    shipmentId = "";

    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Test Store 2", address: "x", termsType: "PUTUS" },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU2-${Date.now()}`, nameId: "Test Item 2", nameEn: "Test Item 2", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO2-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 100000,
        total: 100000,
        lines: { create: [{ itemId, productName: "Test Item 2", qty: 10, unitPrice: 10000, lineTotal: 100000 }] },
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
    await prisma.fieldSalesOrderLine.delete({ where: { id: seededId(lineId) } });
    await prisma.fieldSalesOrder.delete({ where: { id: seededId(orderId) } });
    await prisma.item.delete({ where: { id: seededId(itemId) } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
  });

  it("updates carrier and resi while PACKED", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-1" });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.carrierName).toBe("JNE");
    expect(shipment?.resiNumber).toBe("RESI-1");
  });

  it("refuses ship without a resi for EXPEDITION", async () => {
    await expect(
      shipDeliveryShipment({ shipmentId, shippedById: userId }),
    ).rejects.toMatchObject({ code: "MISSING_RESI" });
  });

  it("ships once resi is set, moving to IN_TRANSIT", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-2" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("IN_TRANSIT");
    expect(shipment?.shippedById).toBe(userId);
    expect(shipment?.shippedAt).not.toBeNull();
  });

  it("refuses ship from a non-PACKED status", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-3" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    await expect(
      shipDeliveryShipment({ shipmentId, shippedById: userId }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
