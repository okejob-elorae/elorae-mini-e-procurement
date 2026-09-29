import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listDeliveryShipments, getDeliveryShipment, getDeliveryShipmentDetail, listMyDeliveries, listShipmentsForOrder } from "./shipment-queries";
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
    /* Scoped by order, not by the fixture's own shipment id, so a shipment a test creates on top
       is still cleaned up when that test's assertions fail before it could tidy up after itself. */
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: seededId(orderId) } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: seededId(orderId) } });
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

  it("does not list an EXPEDITION shipment for its carriedById, even when IN_TRANSIT", async () => {
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
    expect(mine.some((m) => m.id === shipmentId)).toBe(false);
  });

  it("lists only IN_TRANSIT SALESMAN_CARRY shipments, each to its own carrier", async () => {
    /* An existing seeded user, so there is nothing extra to tear down. */
    const otherUser = await prisma.user.findFirst({ where: { id: { not: userId } } });
    expect(otherUser).not.toBeNull();
    const otherUserId = otherUser!.id;

    const carryFor = async (carrierId: string, qty: number) => {
      const line = await prisma.fieldSalesOrderLine.create({
        data: { orderId, itemId, productName: "Query Item Carry", qty, unitPrice: 10000, lineTotal: qty * 10000 },
      });
      const created = await createDeliveryShipment({
        orderId,
        method: "SALESMAN_CARRY",
        lines: [{ orderLineId: line.id, qty }],
        packedById: userId,
      });
      await updateShipmentTracking({
        shipmentId: created.shipmentId,
        carriedById: carrierId,
        invoiceDate: new Date("2026-09-10T00:00:00.000Z"),
        dueDate: new Date("2026-09-20T00:00:00.000Z"),
      });
      await shipDeliveryShipment({ shipmentId: created.shipmentId, shippedById: userId });
      return created.shipmentId;
    };
    const mineId = await carryFor(userId, 3);
    const theirsId = await carryFor(otherUserId, 2);

    const mine = await listMyDeliveries(userId);
    expect(mine.some((m) => m.id === mineId)).toBe(true);
    expect(mine.some((m) => m.id === theirsId)).toBe(false);

    const theirs = await listMyDeliveries(otherUserId);
    expect(theirs.some((m) => m.id === theirsId)).toBe(true);
    expect(theirs.some((m) => m.id === mineId)).toBe(false);
  });

  it("returns orderType on getDeliveryShipment", async () => {
    const detail = await getDeliveryShipment(shipmentId);
    expect(detail?.orderType).toBe("PUTUS");
  });

  it("lists shipments for an order, newest first, with lines and productName", async () => {
    const extraLine = await prisma.fieldSalesOrderLine.create({
      data: { orderId, itemId, productName: "Query Item 2", qty: 3, unitPrice: 10000, lineTotal: 30000 },
    });
    const second = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: extraLine.id, qty: 3 }],
      packedById: userId,
    });
    /* Backdate the first shipment so ordering is deterministic rather than racing on `now()`. */
    await prisma.deliveryShipment.update({
      where: { id: shipmentId },
      data: { packedAt: new Date(Date.now() - 60_000) },
    });

    const shipments = await listShipmentsForOrder(orderId);
    expect(shipments).toHaveLength(2);
    expect(shipments[0].id).toBe(second.shipmentId);
    expect(shipments[1].id).toBe(shipmentId);
    expect(shipments[0].lines).toHaveLength(1);
    expect(shipments[0].lines[0].productName).toBe("Query Item 2");
    expect(shipments[1].lines).toHaveLength(1);
    expect(shipments[1].lines[0].productName).toBe("Query Item");
  });

  describe("getDeliveryShipmentDetail", () => {
    it("returns null for an unknown id", async () => {
      expect(await getDeliveryShipmentDetail("does-not-exist")).toBeNull();
    });

    it("derives photo URLs from the R2 keys, never from the stored URL columns", async () => {
      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: {
          status: "DELIVERED",
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/1700000000.jpg`,
          proofPhotoUrl: "https://evil.example/goods.jpg",
          signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
          signatureUrl: "https://evil.example/nota.jpg",
          signedByName: "Bu Receiver",
          gpsLat: "-6.2000000",
          gpsLng: "106.8000000",
          gpsDistanceMeters: 42,
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto.url).toMatch(new RegExp(`delivery-proofs/${shipmentId}/1700000000\\.jpg$`));
      expect(detail?.goodsPhoto.unavailable).toBe(false);
      expect(detail?.notaPhoto.url).toMatch(new RegExp(`delivery-pod-proofs/${shipmentId}/nota\\.jpg$`));
      expect(JSON.stringify(detail)).not.toContain("evil.example");
      expect(detail?.signedByName).toBe("Bu Receiver");
      expect(detail?.gpsLat).toBeCloseTo(-6.2);
      expect(detail?.gpsLng).toBeCloseTo(106.8);
      expect(detail?.gpsDistanceMeters).toBe(42);
    });

    it("binds a SALESMAN_CARRY goods photo to the pod folder", async () => {
      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: {
          method: "SALESMAN_CARRY",
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/1700000000.jpg`,
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto).toEqual({ url: null, unavailable: true });

      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: { proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg` },
      });
      const bound = await getDeliveryShipmentDetail(shipmentId);
      expect(bound?.goodsPhoto.url).toMatch(new RegExp(`delivery-pod-proofs/${shipmentId}/goods\\.jpg$`));
      expect(bound?.goodsPhoto.unavailable).toBe(false);
    });

    it("yields no URL and flags unavailable for a malformed or foreign key", async () => {
      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: {
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/../other/x.jpg`,
          signatureR2Key: "delivery-pod-proofs/another-shipment/nota.jpg",
          signatureUrl: "https://evil.example/nota.jpg",
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto).toEqual({ url: null, unavailable: true });
      expect(detail?.notaPhoto).toEqual({ url: null, unavailable: true });
    });

    it("flags a legacy stored URL with no key, and reports no photo when neither exists", async () => {
      const bare = await getDeliveryShipmentDetail(shipmentId);
      expect(bare?.goodsPhoto).toEqual({ url: null, unavailable: false });
      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: { proofPhotoUrl: "https://legacy.example/goods.jpg" },
      });
      const legacy = await getDeliveryShipmentDetail(shipmentId);
      expect(legacy?.goodsPhoto).toEqual({ url: null, unavailable: true });
    });

    it("resolves actor names and renders a missing user as null", async () => {
      const salesman = await prisma.user.findUnique({ where: { id: userId } });
      await prisma.deliveryShipment.update({
        where: { id: shipmentId },
        data: { shippedById: "dangling-user-id", carriedById: userId },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.packedByName).toBe(salesman!.name || salesman!.email);
      expect(detail?.carriedByName).toBe(salesman!.name || salesman!.email);
      expect(detail?.shippedByName).toBeNull();
      expect(detail?.deliveredByName).toBeNull();
    });

    it("returns store, order and line facts", async () => {
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.storeName).toBe("Query Store");
      expect(detail?.orderId).toBe(orderId);
      expect(detail?.accountingDocNo).toBeNull();
      expect(detail?.konsiTransferDocNo).toBeNull();
      expect(detail?.lines).toHaveLength(1);
      expect(detail?.lines[0]).toMatchObject({ productName: "Query Item", plannedQty: 4, deliveredQty: null });
    });
  });
});
