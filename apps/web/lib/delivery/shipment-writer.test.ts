import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
  cancelDeliveryShipment,
} from "./shipment-writer";
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
  /* Second, independent fixture set for the SALESMAN_CARRY tests below — each of those tests
   * creates its own store/item/order rather than reusing the EXPEDITION shipment/order this
   * describe's beforeEach seeds, so a SALESMAN_CARRY test can never contend with the
   * beforeEach-created shipment for in-flight qty on a shared order line (PR #288's guard). */
  let carryStoreId = "";
  let carryOrderId = "";
  let carryLineId = "";
  let carryItemId = "";
  let carryShipmentId = "";

  beforeEach(async () => {
    storeId = "";
    userId = "";
    orderId = "";
    lineId = "";
    itemId = "";
    shipmentId = "";
    carryStoreId = "";
    carryOrderId = "";
    carryLineId = "";
    carryItemId = "";
    carryShipmentId = "";

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

    /* Second fixture set — only populated by the SALESMAN_CARRY tests below, so deleteMany
     * (not delete) throughout: it must no-op harmlessly on every other test in this describe. */
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: seededId(carryShipmentId) } });
    await prisma.deliveryShipment.deleteMany({ where: { id: seededId(carryShipmentId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { id: seededId(carryLineId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(carryOrderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(carryItemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(carryStoreId) } });
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
    expect(shipment).not.toBeNull();
    expect(shipment?.status).toBe("IN_TRANSIT");
    expect(shipment?.shippedById).toBe(userId);
    /**
     * `toBeInstanceOf(Date)`, not `not.toBeNull()`: optional chaining turns a missing row into
     * `undefined`, and `expect(undefined).not.toBeNull()` passes — an assertion that cannot fail.
     */
    expect(shipment?.shippedAt).toBeInstanceOf(Date);
  });

  it("refuses ship from a non-PACKED status", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-3" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    await expect(
      shipDeliveryShipment({ shipmentId, shippedById: userId }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("sets carriedById, invoiceDate, and dueDate", async () => {
    const invoiceDate = new Date("2026-09-10T00:00:00.000Z");
    const dueDate = new Date("2026-09-20T00:00:00.000Z");
    await updateShipmentTracking({ shipmentId, carriedById: userId, invoiceDate, dueDate });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.carriedById).toBe(userId);
    expect(shipment?.invoiceDate?.toISOString()).toBe(invoiceDate.toISOString());
    expect(shipment?.dueDate?.toISOString()).toBe(dueDate.toISOString());
  });

  it("leaves carriedById/invoiceDate/dueDate untouched when not supplied", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE" });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.carrierName).toBe("JNE");
    expect(shipment?.carriedById).toBeNull();
    expect(shipment?.invoiceDate).toBeNull();
  });

  it("still refuses when the shipment is not PACKED", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-CARRY" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    await expect(
      updateShipmentTracking({ shipmentId, carriedById: userId }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  /**
   * Fresh store/item/order per SALESMAN_CARRY test rather than reusing the beforeEach's
   * `orderId`/`lineId` (which already carries the beforeEach's own EXPEDITION shipment) — fully
   * isolated, so this fixture can never contend with that shipment for in-flight qty on a shared
   * order line (PR #288's guard), independent of the exact qty either fixture seeds.
   */
  async function seedCarryOrder() {
    const store = await prisma.store.create({
      data: { code: `ST-CARRY-${Date.now()}`, name: "Test Store Carry", address: "x", termsType: "PUTUS" },
    });
    carryStoreId = store.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU-CARRY-${Date.now()}`, nameId: "Test Item Carry", nameEn: "Test Item Carry", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    carryItemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO-CARRY-${Date.now()}`,
        storeId: carryStoreId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 100000,
        total: 100000,
        lines: { create: [{ itemId: carryItemId, productName: "Test Item Carry", qty: 10, unitPrice: 10000, lineTotal: 100000 }] },
      },
      include: { lines: true },
    });
    carryOrderId = order.id;
    carryLineId = order.lines[0].id;
  }

  it("refuses to ship SALESMAN_CARRY with no carriedById", async () => {
    await seedCarryOrder();
    const created = await createDeliveryShipment({
      orderId: carryOrderId,
      method: "SALESMAN_CARRY",
      lines: [{ orderLineId: carryLineId, qty: 2 }],
      packedById: userId,
    });
    carryShipmentId = created.shipmentId;
    await expect(
      shipDeliveryShipment({ shipmentId: created.shipmentId, shippedById: userId }),
    ).rejects.toMatchObject({ code: "MISSING_CARRIER" });
  });

  it("refuses to ship SALESMAN_CARRY with carriedById but no dates", async () => {
    await seedCarryOrder();
    const created = await createDeliveryShipment({
      orderId: carryOrderId,
      method: "SALESMAN_CARRY",
      lines: [{ orderLineId: carryLineId, qty: 2 }],
      packedById: userId,
    });
    carryShipmentId = created.shipmentId;
    await updateShipmentTracking({ shipmentId: created.shipmentId, carriedById: userId });
    await expect(
      shipDeliveryShipment({ shipmentId: created.shipmentId, shippedById: userId }),
    ).rejects.toMatchObject({ code: "MISSING_DATES" });
  });

  it("ships SALESMAN_CARRY once carriedById and both dates are set", async () => {
    await seedCarryOrder();
    const created = await createDeliveryShipment({
      orderId: carryOrderId,
      method: "SALESMAN_CARRY",
      lines: [{ orderLineId: carryLineId, qty: 2 }],
      packedById: userId,
    });
    carryShipmentId = created.shipmentId;
    await updateShipmentTracking({
      shipmentId: created.shipmentId,
      carriedById: userId,
      invoiceDate: new Date("2026-09-10T00:00:00.000Z"),
      dueDate: new Date("2026-09-20T00:00:00.000Z"),
    });
    await shipDeliveryShipment({ shipmentId: created.shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: created.shipmentId } });
    expect(shipment?.status).toBe("IN_TRANSIT");
  });

  it("does not require carriedById or dates to ship EXPEDITION", async () => {
    /* Regression check: the new guards must be method-conditional, not universal. */
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-REG" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("IN_TRANSIT");
  });
});

describe("completeDeliveryShipment", () => {
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let itemId = "";
  let shipmentId = "";
  let shipmentLineId = "";
  let deliveryId = "";
  /**
   * A SECOND, purpose-created user for the NOT_CARRIER test — the only test here that needs two
   * distinct actor identities. Created fresh (not `findFirst`ed like `salesman@elorae.com`, which
   * is a shared seed row this teardown must never delete) and torn down with `deleteMany` so it
   * no-ops harmlessly for every other test in this describe.
   */
  let otherUserId = "";

  async function seedInTransitShipment(qty: number) {
    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Test Store 3", address: "x", termsType: "PUTUS" },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU3-${Date.now()}`, nameId: "Test Item 3", nameEn: "Test Item 3", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO3-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 100000,
        total: 100000,
        lines: { create: [{ itemId, productName: "Test Item 3", qty, unitPrice: 10000, lineTotal: qty * 10000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
    /**
     * recordFieldSalesDelivery (called by completeDeliveryShipment for PUTUS orders) consumes
     * against a pre-existing StockReservation row keyed on fieldSalesLineId, and against an
     * InventoryValue row keyed on (itemId, variantSku) — neither is created by inserting the
     * order directly, only by the real approve-time reservation flow this test bypasses. Without
     * these, consumeFieldSalesOrderPartial throws OVER_CONSUME / InventoryValueMissingError.
     */
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: qty, reservedQty: qty, avgCost: 500, totalValue: qty * 500 },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty, state: "RESERVED" },
    });
    const created = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: lineId, qty }],
      packedById: userId,
    });
    shipmentId = created.shipmentId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId }, include: { lines: true } });
    shipmentLineId = shipment!.lines[0].id;
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-X" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
  }

  /**
   * SALESMAN_CARRY twin of `seedInTransitShipment`: a fresh store/item/order per call (this
   * describe has no `beforeEach`, so nothing is shared between tests), populating the SAME
   * fixture variables the helper above does — which is what lets the single `afterEach` below
   * clean up after either helper without a second parallel teardown block. The store carries
   * lat/lng/checkinRadiusMeters because completion now gates on them.
   */
  async function seedSalesmanCarryShipment(qty: number, storeOverrides: {
    lat?: number; lng?: number; checkinRadiusMeters?: number;
  } = {}) {
    const store = await prisma.store.create({
      data: {
        code: `ST-SC-${Date.now()}`,
        name: "Salesman Carry Store",
        address: "x",
        termsType: "PUTUS",
        lat: storeOverrides.lat,
        lng: storeOverrides.lng,
        checkinRadiusMeters: storeOverrides.checkinRadiusMeters ?? 100,
      },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU-SC-${Date.now()}`, nameId: "Carry Item", nameEn: "Carry Item", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO-SC-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: qty * 10000,
        total: qty * 10000,
        lines: { create: [{ itemId, productName: "Carry Item", qty, unitPrice: 10000, lineTotal: qty * 10000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
    /* Same reservation/inventory prerequisite `seedInTransitShipment` documents above. */
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: qty, reservedQty: qty, avgCost: 500, totalValue: qty * 500 },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty, state: "RESERVED" },
    });
    const created = await createDeliveryShipment({
      orderId,
      method: "SALESMAN_CARRY",
      lines: [{ orderLineId: lineId, qty }],
      packedById: userId,
    });
    shipmentId = created.shipmentId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId }, include: { lines: true } });
    shipmentLineId = shipment!.lines[0].id;
    await updateShipmentTracking({
      shipmentId,
      carriedById: userId,
      invoiceDate: new Date("2026-09-10T00:00:00.000Z"),
      dueDate: new Date("2026-09-20T00:00:00.000Z"),
    });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
  }

  afterEach(async () => {
    /**
     * FIRST, before the delivery chain below: `recordFieldSalesDelivery` writes a `SalesHistory`
     * row per delivered line, and nothing else in this teardown reaches it. Left behind, those
     * rows accumulate permanently in the shared `:3308` bed. Same ordering the canonical sibling
     * teardown uses (`lib/field-sales/delivery/writer.test.ts`).
     */
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    if (deliveryId) {
      await prisma.receivable.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
      await prisma.taxInvoice.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
      await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
      await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    }
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: seededId(shipmentId) } });
    await prisma.deliveryShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    /* AFTER the order/delivery chain above — an order references its salesman, and this user is
     * never the salesman on any fixture order, but the ordering keeps that true by construction. */
    await prisma.user.deleteMany({ where: { id: seededId(otherUserId) } });
    storeId = userId = orderId = lineId = itemId = shipmentId = shipmentLineId = deliveryId = "";
    otherUserId = "";
  });

  it("refuses completion without a proof photo url", async () => {
    await seedInTransitShipment(4);
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "",
        proofPhotoR2Key: "",
        invoiceDate: new Date(),
        dueDate: new Date(),
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_PROOF" });
  });

  it("completes fully delivered lines as DELIVERED and calls recordFieldSalesDelivery", async () => {
    await seedInTransitShipment(4);
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-proofs/x.jpg",
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400000),
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;

    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("DELIVERED");
    expect(shipment?.deliveryId).toBe(result.deliveryId);

    const delivery = await prisma.fieldSalesDelivery.findUnique({ where: { id: result.deliveryId } });
    expect(delivery).not.toBeNull();
  });

  it("marks PARTIALLY_DELIVERED when a line under-delivers, and only consumes the delivered qty", async () => {
    await seedInTransitShipment(4);
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-proofs/x.jpg",
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400000),
      lines: [{ shipmentLineId, deliveredQty: 3 }],
    });
    deliveryId = result.deliveryId;

    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId }, include: { lines: true } });
    expect(shipment?.status).toBe("PARTIALLY_DELIVERED");
    expect(shipment?.lines[0].deliveredQty).toBe(3);

    const orderLine = await prisma.fieldSalesOrderLine.findUnique({ where: { id: lineId } });
    expect(orderLine?.deliveredQty).toBe(3);
  });

  it("refuses a deliveredQty above plannedQty", async () => {
    await seedInTransitShipment(4);
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-proofs/x.jpg",
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        lines: [{ shipmentLineId, deliveredQty: 999 }],
      }),
    ).rejects.toMatchObject({ code: "OVER_PLANNED" });
  });

  it("refuses completion from a non-IN_TRANSIT status", async () => {
    /**
     * A same-actor retry against an already-DELIVERED shipment is now a legitimate idempotent
     * replay (returns ok, per the new guard) rather than INVALID_STATE — covered separately
     * below. This test proves the status refusal still holds for a DIFFERENT actor hitting the
     * now-DELIVERED shipment, which is what non-IN_TRANSIT genuinely still refuses.
     */
    await seedInTransitShipment(4);
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-proofs/x.jpg",
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400000),
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    }).then((r) => { deliveryId = r.deliveryId; });

    const other = await prisma.user.create({
      data: { email: `other-non-in-transit-${Date.now()}@example.com`, name: "Other", role: "USER" },
    });
    otherUserId = other.id;

    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: otherUserId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-proofs/x.jpg",
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("does not call the stock-consuming delivery path for a KONSI order", async () => {
    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Konsi Store", address: "x", termsType: "KONSI" },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKUK-${Date.now()}`, nameId: "Konsi Item", nameEn: "Konsi Item", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSOK-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "KONSI",
        subtotal: 40000,
        total: 40000,
        lines: { create: [{ itemId, productName: "Konsi Item", qty: 4, unitPrice: 10000, lineTotal: 40000 }] },
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
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId }, include: { lines: true } });
    shipmentLineId = shipment!.lines[0].id;
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-K" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });

    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-proofs/k.jpg",
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400000),
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });

    const finalShipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(finalShipment?.status).toBe("DELIVERED");
    expect(finalShipment?.deliveryId).toBeNull();
    expect(result.deliveryId).toBe("");

    const orderLine = await prisma.fieldSalesOrderLine.findUnique({ where: { id: lineId } });
    expect(orderLine?.deliveredQty).toBe(0);
  });

  it("refuses SALESMAN_CARRY completion by a user other than carriedById", async () => {
    /**
     * The feature's anti-fraud property. Everything about this payload is VALID except the actor:
     * the proof photo is present, the coordinates are an exact match on the store (0m, well inside
     * the radius), and the shipment carries both nota dates — so the only thing that can refuse it
     * is the carrier-identity check. `seedSalesmanCarryShipment` assigns `carriedById: userId`
     * (the shared `salesman@elorae.com` row), and this call completes as a DIFFERENT user.
     */
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const other = await prisma.user.create({
      data: { email: `carry-other-${Date.now()}@test.local`, name: "Other Salesman", role: "USER" },
    });
    otherUserId = other.id;
    expect(otherUserId).not.toBe(userId);

    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: otherUserId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "NOT_CARRIER" });

    /* Nothing escaped the refusal: still completable by the real carrier, no stock consumed. */
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("IN_TRANSIT");
    expect(shipment?.deliveredById).toBeNull();
    expect(shipment?.deliveryId).toBeNull();
    const orderLine = await prisma.fieldSalesOrderLine.findUnique({ where: { id: lineId } });
    expect(orderLine?.deliveredQty).toBe(0);
  });

  it("refuses SALESMAN_CARRY completion with no gps", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_GPS" });
  });

  it("refuses SALESMAN_CARRY completion with non-finite or out-of-range gps coordinates", async () => {
    /**
     * The declared `number` type is not a runtime guarantee. Without the finiteness/range guard
     * `{ lat: null, lng: null }` OPENS the gate: `null - null` coerces to 0 inside
     * `haversineMeters`, so the distance is 0, which passes both the `=== null` and the
     * `> radius` checks and completes the delivery with a fabricated 0-metre audit record.
     */
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8 });
    for (const gps of [
      { lat: null as unknown as number, lng: null as unknown as number },
      { lat: Number.NaN, lng: Number.NaN },
      { lat: -6.2, lng: Number.POSITIVE_INFINITY },
      { lat: 91, lng: 106.8 },
      { lat: -6.2, lng: -181 },
    ]) {
      await expect(
        completeDeliveryShipment({
          shipmentId,
          deliveredById: userId,
          proofPhotoUrl: "https://r2.example/proof.jpg",
          proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
          gps,
          lines: [{ shipmentLineId, deliveredQty: 4 }],
        }),
      ).rejects.toMatchObject({ code: "MISSING_GPS" });
    }
    /* Every rejection must have left the shipment completable — no partial write escaped. */
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("IN_TRANSIT");
    expect(shipment?.gpsDistanceMeters).toBeNull();
  });

  it("refuses SALESMAN_CARRY completion when the store has no lat/lng", async () => {
    await seedSalesmanCarryShipment(4);
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "STORE_NOT_GEOCODED" });
  });

  it("refuses SALESMAN_CARRY completion when the coordinates are out of radius", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.3, lng: 106.8 }, /* ~11km away, well outside a 100m radius */
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "GPS_OUT_OF_RADIUS" });
  });

  it("completes SALESMAN_CARRY within radius, stamping gps fields and reading dates from the shipment row", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
      gps: { lat: -6.2, lng: 106.8 }, /* exact match, 0m */
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota-x.jpg`,
      signedByName: "Budi Santoso",
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("DELIVERED");
    expect(shipment?.gpsDistanceMeters).toBe(0);
    expect(Number(shipment?.gpsLat)).toBeCloseTo(-6.2, 5);
    /* The dates come off the SHIPMENT ROW (seeded at pack time), never off the call's input —
     * this call passes neither, and the accounting record still carries the admin's figures. */
    const delivery = await prisma.fieldSalesDelivery.findUnique({ where: { id: result.deliveryId } });
    expect(delivery?.invoiceDate.toISOString()).toBe(new Date("2026-09-10T00:00:00.000Z").toISOString());
  });

  it("refuses SALESMAN_CARRY completion with no nota photo", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        signedByName: "Budi Santoso",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
        /* signatureUrl/signatureR2Key deliberately omitted */
      }),
    ).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
  });

  it("refuses SALESMAN_CARRY completion with a blank nota photo key", async () => {
    /* Proves the trim fix, not truthiness-only — a whitespace-only key must still refuse. */
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: "   ",
        signedByName: "Budi Santoso",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
  });

  it("refuses SALESMAN_CARRY completion when the nota photo key equals the goods photo key", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/shared.jpg`,
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: `delivery-pod-proofs/${shipmentId}/shared.jpg`,
        signedByName: "Budi Santoso",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
  });

  it("refuses SALESMAN_CARRY completion when the nota photo key has no shipment-scoped prefix", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: "delivery-pod-proofs/some-other-shipment/nota.jpg",
        signedByName: "Budi Santoso",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
  });

  it("refuses SALESMAN_CARRY completion with no signed-by name", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota-x.jpg`,
        lines: [{ shipmentLineId, deliveredQty: 4 }],
        /* signedByName deliberately omitted */
      }),
    ).rejects.toMatchObject({ code: "MISSING_SIGNED_BY" });
  });

  it("refuses SALESMAN_CARRY completion with a whitespace-only signed-by name", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota-x.jpg`,
        signedByName: "   ",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_SIGNED_BY" });
  });

  it("refuses SALESMAN_CARRY completion with a signed-by name over 120 characters", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        signatureUrl: "https://r2.example/nota.jpg",
        signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota-x.jpg`,
        signedByName: "A".repeat(121),
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_SIGNED_BY" });
  });

  it("completes SALESMAN_CARRY with all fields present, stamping the nota photo and signed-by name", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota-x.jpg`,
      signedByName: "  Budi Santoso  ",
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("DELIVERED");
    expect(shipment?.signatureUrl).toBe("https://r2.example/nota.jpg");
    expect(shipment?.signatureR2Key).toBe(`delivery-pod-proofs/${shipmentId}/nota-x.jpg`);
    /* Trimmed before storage. */
    expect(shipment?.signedByName).toBe("Budi Santoso");
  });

  it("refuses SALESMAN_CARRY completion if dates are somehow still missing on the shipment row", async () => {
    /* Defensive: shipDeliveryShipment already guards this at ship time, but
       completeDeliveryShipment must not silently proceed if it's ever reachable another way. */
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8 });
    await prisma.deliveryShipment.update({ where: { id: shipmentId }, data: { invoiceDate: null } });
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-pod-proofs/x.jpg",
        gps: { lat: -6.2, lng: 106.8 },
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_DATES" });
  });

  it("still requires invoiceDate/dueDate as input for EXPEDITION (regression)", async () => {
    /* The dates became OPTIONAL in the type so SALESMAN_CARRY can omit them; EXPEDITION must
       still refuse without them rather than reaching recordFieldSalesDelivery undefined. */
    await seedInTransitShipment(4);
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: userId,
        proofPhotoUrl: "https://r2.example/proof.jpg",
        proofPhotoR2Key: "delivery-proofs/x.jpg",
        lines: [{ shipmentLineId, deliveredQty: 4 }],
        /* invoiceDate/dueDate deliberately omitted */
      }),
    ).rejects.toMatchObject({ code: "MISSING_DATES" });
  });

  it("returns ok on a same-actor replay of an already-DELIVERED shipment, without re-running any gate", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const first = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Budi Santoso",
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = first.deliveryId;
    /* Replay: no gps, no photos, no signature — proves the replay short-circuits before
       any of those checks ever run, not merely that it happens to still satisfy them. */
    const second = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "",
      proofPhotoR2Key: "",
      lines: [],
    });
    expect(second).toEqual({ ok: true, deliveryId: first.deliveryId });
  });

  it("still refuses INVALID_STATE for a DIFFERENT actor against an already-DELIVERED shipment", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const first = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Budi Santoso",
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = first.deliveryId;
    const otherUser = await prisma.user.create({
      data: { email: `other-${Date.now()}@example.com`, name: "Other", passwordHash: "x", roleId: (await prisma.roleDefinition.findFirst({ where: { name: "SALESMAN" } }))!.id },
    });
    otherUserId = otherUser.id;
    await expect(
      completeDeliveryShipment({
        shipmentId,
        deliveredById: otherUserId,
        proofPhotoUrl: "https://r2.example/proof2.jpg",
        proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods2.jpg`,
        lines: [{ shipmentLineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("clamps a future deliveredAt to now", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const before = new Date();
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Budi Santoso",
      deliveredAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in the future
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.deliveredAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("clamps a deliveredAt more than 3 days old to now", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const before = new Date();
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Budi Santoso",
      deliveredAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.deliveredAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("stores a deliveredAt within the 3-day window as given, and stamps completedOfflineAt only when completedOffline is true", async () => {
    await seedSalesmanCarryShipment(4, { lat: -6.2, lng: 106.8, checkinRadiusMeters: 100 });
    const capturedAt = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
      gps: { lat: -6.2, lng: 106.8 },
      signatureUrl: "https://r2.example/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
      signedByName: "Budi Santoso",
      deliveredAt: capturedAt,
      completedOffline: true,
      lines: [{ shipmentLineId, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.deliveredAt!.toISOString()).toBe(capturedAt.toISOString());
    expect(shipment?.completedOfflineAt).not.toBeNull();
    const delivery = await prisma.fieldSalesDelivery.findUnique({ where: { id: result.deliveryId } });
    expect(delivery?.deliveredAt.toISOString()).toBe(capturedAt.toISOString());
  });
});

describe("cancelDeliveryShipment", () => {
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let itemId = "";
  let shipmentId = "";
  let deliveryId = "";

  beforeEach(async () => {
    storeId = userId = orderId = lineId = itemId = shipmentId = deliveryId = "";
    const store = await prisma.store.create({
      data: { code: `ST-${Date.now()}`, name: "Test Store 4", address: "x", termsType: "PUTUS" },
    });
    storeId = store.id;
    const salesman = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = salesman!.id;
    const uom = await prisma.uOM.findFirst({ where: { code: "PCS" } });
    const item = await prisma.item.create({
      data: { sku: `SKU4-${Date.now()}`, nameId: "Test Item 4", nameEn: "Test Item 4", type: "FINISHED_GOOD", uomId: uom!.id, sellingPrice: 10000 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `FSO4-${Date.now()}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 40000,
        total: 40000,
        lines: { create: [{ itemId, productName: "Test Item 4", qty: 4, unitPrice: 10000, lineTotal: 40000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
    /**
     * The DELIVERED-shipment test completes this shipment first, and the order defaults to
     * `orderType: "PUTUS"`, so completion reaches `recordFieldSalesDelivery` →
     * `consumeFieldSalesOrderPartial`. That consume needs a RESERVED `StockReservation` keyed on
     * `fieldSalesLineId` plus an `InventoryValue` row keyed on (itemId, variantSku) — inserting
     * the order directly creates neither, only the real approve-time reservation flow does. With
     * them missing the completion throws OVER_CONSUME → OVER_DELIVER on a bare `await`, so the
     * cancel assertion the test exists for is never reached. Identical seed to
     * `seedInTransitShipment` in the completeDeliveryShipment describe above.
     */
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 4, reservedQty: 4, avgCost: 500, totalValue: 2000 },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4, state: "RESERVED" },
    });
    const created = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: lineId, qty: 4 }],
      packedById: userId,
    });
    shipmentId = created.shipmentId;
  });

  afterEach(async () => {
    /* First, for the same reason as the completeDeliveryShipment describe: a completed shipment
     * leaves SalesHistory rows nothing else here deletes. */
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: seededId(shipmentId) }, select: { deliveryId: true } });
    if (shipment?.deliveryId) {
      await prisma.receivable.deleteMany({ where: { deliveryId: seededId(shipment.deliveryId) } });
      await prisma.taxInvoice.deleteMany({ where: { deliveryId: seededId(shipment.deliveryId) } });
      await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(shipment.deliveryId) } });
      await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(shipment.deliveryId) } });
    }
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: seededId(shipmentId) } });
    await prisma.deliveryShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    /* The DELIVERED test's completion moves stock, so the same three side-effect tables the
     * completeDeliveryShipment describe cleans up are in play here too. */
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("cancels a PACKED shipment", async () => {
    await cancelDeliveryShipment({ shipmentId, cancelledById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("CANCELLED");
  });

  it("cancels an IN_TRANSIT shipment", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-C" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    await cancelDeliveryShipment({ shipmentId, cancelledById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("CANCELLED");
  });

  it("refuses to cancel a DELIVERED shipment", async () => {
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: "RESI-D" });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUnique({ where: { id: shipmentId }, include: { lines: true } });
    const result = await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: "delivery-proofs/d.jpg",
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400000),
      lines: [{ shipmentLineId: shipment!.lines[0].id, deliveredQty: 4 }],
    });
    deliveryId = result.deliveryId;
    await expect(
      cancelDeliveryShipment({ shipmentId, cancelledById: userId }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
