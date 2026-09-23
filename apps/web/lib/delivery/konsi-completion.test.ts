import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "@/lib/field-sales/writer";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
} from "./shipment-writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the create-time fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

d("completeDeliveryShipment konsi stock move (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let orderId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    salesmanId = "";
    visitId = "";
    orderId = "";
    lineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KDC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KDC-${token}`, nameId: "Konsi completion item", nameEn: "Konsi completion item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 10000, totalValue: 500000 } });

    const store = await prisma.store.create({
      data: {
        code: `TEST-KDC-STORE-${token}`,
        name: "Test Konsi Completion Store",
        address: "Test address",
        termsType: "KONSI",
        marginPercent: 20,
        isActive: true,
        lat: -6.2,
        lng: 106.8,
        checkinRadiusMeters: 100,
      },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({ data: { email: `test-kdc-${token}@example.com`, name: "Test Konsi Completion Salesman" } });
    salesmanId = salesman.id;

    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: -6.2, checkinLng: 106.8 } });
    visitId = visit.id;

    const { orderId: newOrderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "Konsi completion line", qty: 6, unitPrice: 0 }],
    });
    orderId = newOrderId;
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });
    lineId = line.id;
  });

  afterEach(async () => {
    /*
     * createFieldSalesOrder writes one AdminNotification per order with no orderId column to
     * filter on (only a Json metadata blob), and Prisma's JSON path filtering is unreliable on
     * this MariaDB adapter. So: read the category's rows, match orderId in JS against our own
     * seeded id, then delete by the resulting explicit id list — never by category alone, which
     * would over-match every other test's notifications.
     */
    const candidateNotifs = await prisma.adminNotification.findMany({
      where: { category: "PENDING_ORDER_APPROVAL" },
      select: { id: true, metadata: true },
    });
    const leakedNotifIds = candidateNotifs
      .filter((n) => (n.metadata as { orderId?: string } | null)?.orderId === orderId)
      .map((n) => n.id);
    if (leakedNotifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: leakedNotifIds } } });

    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: seededId(orderId) } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
  });

  const packAndShip = async (method: "EXPEDITION" | "SALESMAN_CARRY", qty: number) => {
    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method,
      lines: [{ orderLineId: lineId, qty }],
      packedById: salesmanId,
    });
    if (method === "EXPEDITION") {
      await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `RESI-${token}` });
    } else {
      await updateShipmentTracking({ shipmentId, carriedById: salesmanId });
    }
    await shipDeliveryShipment({ shipmentId, shippedById: salesmanId });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    return { shipmentId, shipmentLineId: shipment.lines[0].id };
  };

  const completeExpedition = (shipmentId: string, shipmentLineId: string, deliveredQty: number, actor = salesmanId) =>
    completeDeliveryShipment({
      shipmentId,
      deliveredById: actor,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
      lines: [{ shipmentLineId, deliveredQty }],
    });

  it("full delivery writes one transfer linked by shipmentId, advances deliveredQty and marks the order DELIVERED", async () => {
    const { shipmentId, shipmentLineId } = await packAndShip("EXPEDITION", 6);
    const result = await completeExpedition(shipmentId, shipmentLineId, 6);
    expect(result.deliveryId).toBe("");
    const transfers = await prisma.konsiTransfer.findMany({ where: { orderId: seededId(orderId) } });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].shipmentId).toBe(shipmentId);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(line.deliveredQty).toBe(6);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) } });
    expect(order.deliveryStatus).toBe("DELIVERED");
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(6);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment.status).toBe("DELIVERED");
    expect(shipment.deliveryId).toBeNull();
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(orderId) } })).toBe(0);
  });

  it("a short line is PARTIALLY_DELIVERED, keeps the remainder reserved, and a second shipment transfers the rest", async () => {
    const first = await packAndShip("EXPEDITION", 6);
    await completeExpedition(first.shipmentId, first.shipmentLineId, 4);
    let shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: first.shipmentId } });
    expect(shipment.status).toBe("PARTIALLY_DELIVERED");
    let order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) } });
    expect(order.deliveryStatus).toBe("PARTIAL");
    let inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.qtyOnHand)).toBe(46);
    expect(Number(inv.reservedQty)).toBe(2);

    const second = await packAndShip("EXPEDITION", 2);
    await completeExpedition(second.shipmentId, second.shipmentLineId, 2);
    shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: second.shipmentId } });
    expect(shipment.status).toBe("DELIVERED");
    order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) } });
    expect(order.deliveryStatus).toBe("DELIVERED");
    inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.qtyOnHand)).toBe(44);
    expect(Number(inv.reservedQty)).toBe(0);
    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("CONSUMED");
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(2);
  });

  it("an all-zero completion writes no transfer but still moves the shipment", async () => {
    const { shipmentId, shipmentLineId } = await packAndShip("EXPEDITION", 6);
    await completeExpedition(shipmentId, shipmentLineId, 0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment.status).toBe("PARTIALLY_DELIVERED");
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.reservedQty)).toBe(6);
  });

  it("a same-actor replay writes nothing twice", async () => {
    const { shipmentId, shipmentLineId } = await packAndShip("EXPEDITION", 6);
    await completeExpedition(shipmentId, shipmentLineId, 6);
    await completeExpedition(shipmentId, shipmentLineId, 6);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(1);
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.qtyOnHand)).toBe(44);
  });

  it("salesman-carry konsi ships and completes with no nota dates on the shipment", async () => {
    const { shipmentId, shipmentLineId } = await packAndShip("SALESMAN_CARRY", 6);
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: salesmanId,
      proofPhotoUrl: "https://r2.example/goods.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Pemilik Toko",
      gps: { lat: -6.2, lng: 106.8 },
      lines: [{ shipmentLineId, deliveredQty: 6 }],
    });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment.status).toBe("DELIVERED");
    expect(shipment.invoiceDate).toBeNull();
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(1);
  });

  it("refuses KONSI_NOT_RESERVED against a consumed reservation and leaves the shipment IN_TRANSIT with nothing moved", async () => {
    const { shipmentId, shipmentLineId } = await packAndShip("EXPEDITION", 6);
    /* Simulates a konsi order approved under the old model, whose reservation was consumed at approve. */
    await prisma.stockReservation.update({
      where: { fieldSalesLineId: seededId(lineId) },
      data: { state: "CONSUMED", consumedQty: 6 },
    });
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await expect(completeExpedition(shipmentId, shipmentLineId, 6)).rejects.toMatchObject({ code: "KONSI_NOT_RESERVED" });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment.status).toBe("IN_TRANSIT");
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(line.deliveredQty).toBe(0);
  });
});
