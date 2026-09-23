import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "../writer";
import { InsufficientStockError, KonsiTransferReservationMismatchError } from "../errors";
import { createDeliveryShipment } from "@/lib/delivery/shipment-writer";
import { issueKonsiTransfer } from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the create-time fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

d("issueKonsiTransfer at shipment completion (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let variantlessItemId = "";
  let shortItemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let shipmentIds: string[] = [];

  /* Main scenario: item at avgCost 10.000, one KONSI order of qty 6. */
  let orderId = "";
  let lineId = "";

  /* A second order of the same item into the same store, approved AFTER the fixture bumps main's
     avgCost to 20.000 (simulating a restock at a different cost) — exercises the blend. */
  let secondOrderId = "";

  /* An item whose InventoryValue row is seeded variantSku: null (the real Jubelio shape), ordered
     with the client's variantSku: "" convention — exercises the OR-tolerant lookup. */
  let variantlessOrderId = "";

  /* An item with only 2 on hand, ordered at qty 6 — reserveKonsiFieldSalesOrder must still abort
     this before any transfer runs. */
  let shortOrderId = "";

  /* An item transferred at qty 10 @ avgCost 10.000 into a store whose StoreStock row is seeded
     NEGATIVE (-6, avgCost 0) before the transfer — exercises the blend guard against a negative
     prevStoreQty (see the konsi retur decrement, which is what drives a row negative). */
  let negativeItemId = "";
  let negativeOrderId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    variantlessItemId = "";
    shortItemId = "";
    storeId = "";
    salesmanId = "";
    visitId = "";
    orderId = "";
    lineId = "";
    secondOrderId = "";
    variantlessOrderId = "";
    shortOrderId = "";
    negativeItemId = "";
    negativeOrderId = "";
    shipmentIds = [];

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KTW-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KTW-${token}`, nameId: "Konsi transfer item", nameEn: "Konsi transfer item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 10000, totalValue: 1000000 } });

    const variantlessItem = await prisma.item.create({
      data: { sku: `TEST-KTW-VL-${token}`, nameId: "Variantless konsi item", nameEn: "Variantless konsi item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    variantlessItemId = variantlessItem.id;
    /* Seeded null, the real shape a Jubelio-ingested variantless row takes — not "". */
    await prisma.inventoryValue.create({ data: { itemId: variantlessItemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 8000, totalValue: 400000 } });

    const shortItem = await prisma.item.create({
      data: { sku: `TEST-KTW-SHORT-${token}`, nameId: "Short konsi item", nameEn: "Short konsi item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    shortItemId = shortItem.id;
    await prisma.inventoryValue.create({ data: { itemId: shortItemId, variantSku: "", qtyOnHand: 2, reservedQty: 0, avgCost: 5000, totalValue: 10000 } });

    const negativeItem = await prisma.item.create({
      data: { sku: `TEST-KTW-NEG-${token}`, nameId: "Negative store stock konsi item", nameEn: "Negative store stock konsi item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    negativeItemId = negativeItem.id;
    await prisma.inventoryValue.create({ data: { itemId: negativeItemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 10000, totalValue: 1000000 } });

    const store = await prisma.store.create({
      data: { code: `TEST-KTW-STORE-${token}`, name: "Test Konsi Transfer Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({ data: { email: `test-ktw-${token}@example.com`, name: "Test Konsi Salesman" } });
    salesmanId = salesman.id;

    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    const mkOrder = async (opts: { itemId: string; variantSku: string; qty: number }) => {
      const { orderId: newOrderId } = await createFieldSalesOrder({
        storeId,
        salesmanId,
        visitId,
        lines: [{ itemId: opts.itemId, variantSku: opts.variantSku, productName: "Test konsi line", qty: opts.qty, unitPrice: 0 }],
      });
      return newOrderId;
    };

    orderId = await mkOrder({ itemId, variantSku: "", qty: 6 });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });
    lineId = line.id;

    secondOrderId = await mkOrder({ itemId, variantSku: "", qty: 6 });
    variantlessOrderId = await mkOrder({ itemId: variantlessItemId, variantSku: "", qty: 5 });
    shortOrderId = await mkOrder({ itemId: shortItemId, variantSku: "", qty: 6 });
    negativeOrderId = await mkOrder({ itemId: negativeItemId, variantSku: "", qty: 10 });
  });

  /**
   * Approve (which now only reserves), pack a shipment for `qty` of the order's single line, then
   * run the transfer exactly as shipment completion does — inside one transaction, linked to that
   * shipment. Returns the ids the assertions need.
   */
  const transferVia = async (targetOrderId: string, qty?: number) => {
    await approveFieldSalesOrder({ orderId: targetOrderId, approvedById: salesmanId });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({
      where: { id: seededId(targetOrderId) },
      include: { lines: true },
    });
    const line = order.lines[0];
    const drawQty = qty ?? line.qty;
    const { shipmentId } = await createDeliveryShipment({
      orderId: targetOrderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: line.id, qty: drawQty }],
      packedById: salesmanId,
    });
    shipmentIds.push(shipmentId);
    await prisma.$transaction((tx) =>
      issueKonsiTransfer(tx, {
        order: {
          id: order.id,
          storeId: order.storeId,
          lines: [{ id: line.id, itemId: line.itemId, variantSku: line.variantSku, productName: line.productName, qty: drawQty }],
        },
        shipmentId,
        transferredById: salesmanId,
      }),
    );
    return { shipmentId, lineId: line.id };
  };

  afterEach(async () => {
    const itemIds = [seededId(itemId), seededId(variantlessItemId), seededId(shortItemId), seededId(negativeItemId)];
    const orderIds = [seededId(orderId), seededId(secondOrderId), seededId(variantlessOrderId), seededId(shortOrderId), seededId(negativeOrderId)];

    /*
     * createFieldSalesOrder writes one AdminNotification per order with no orderId column to
     * filter on (only a Json metadata blob), and Prisma's JSON path filtering is unreliable on
     * this MariaDB adapter (see the van-journal-pending follow-up). So: read the category's rows,
     * match orderId in JS against our own seeded ids, then delete by the resulting explicit id
     * list — never by category alone, which would over-match every other test's notifications.
     */
    const candidateNotifs = await prisma.adminNotification.findMany({
      where: { category: "PENDING_ORDER_APPROVAL" },
      select: { id: true, metadata: true },
    });
    const leakedNotifIds = candidateNotifs
      .filter((n) => orderIds.includes((n.metadata as { orderId?: string } | null)?.orderId ?? ""))
      .map((n) => n.id);
    if (leakedNotifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: leakedNotifIds } } });

    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
  });

  it("approve reserves but moves nothing: no transfer, no StoreStock, main qtyOnHand unchanged", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty) + 6);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    expect(await prisma.storeStock.count({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("RESERVED");
    expect(Number(res.consumedQty)).toBe(0);
  });

  it("a full transfer nets qtyOnHand down and reservedQty back to its pre-order level", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await transferVia(orderId);
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) - 6);
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty));
  });

  it("a partial draw advances consumedQty and leaves the reservation RESERVED; the final draw flips it CONSUMED", async () => {
    await transferVia(orderId, 4);
    let res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("RESERVED");
    expect(Number(res.consumedQty)).toBe(4);
    let inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.qtyOnHand)).toBe(96);
    expect(Number(inv.reservedQty)).toBe(2);
    const afterFirstDraw = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(afterFirstDraw.qty)).toBe(4);

    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) } });
    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: line.id, qty: 2 }],
      packedById: salesmanId,
    });
    shipmentIds.push(shipmentId);
    await prisma.$transaction((tx) =>
      issueKonsiTransfer(tx, {
        order: { id: order.id, storeId: order.storeId, lines: [{ id: line.id, itemId: line.itemId, variantSku: line.variantSku, productName: line.productName, qty: 2 }] },
        shipmentId,
        transferredById: salesmanId,
      }),
    );
    res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("CONSUMED");
    expect(Number(res.consumedQty)).toBe(6);
    expect(res.resolvedAt).not.toBeNull();
    inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(inv.qtyOnHand)).toBe(94);
    expect(Number(inv.reservedQty)).toBe(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(2);
  });

  it("refuses an over-draw and rolls back everything", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    const line = order.lines[0];
    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: line.id, qty: 6 }],
      packedById: salesmanId,
    });
    shipmentIds.push(shipmentId);
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await expect(
      prisma.$transaction((tx) =>
        issueKonsiTransfer(tx, {
          order: { id: order.id, storeId: order.storeId, lines: [{ id: line.id, itemId: line.itemId, variantSku: line.variantSku, productName: line.productName, qty: 7 }] },
          shipmentId,
          transferredById: salesmanId,
        }),
      ),
    ).rejects.toBeInstanceOf(KonsiTransferReservationMismatchError);
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty));
    expect(await prisma.storeStock.count({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("RESERVED");
    expect(Number(res.consumedQty)).toBe(0);
  });

  it("refuses a zero draw rather than passing the reservation guard as a no-op", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    const line = order.lines[0];
    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: line.id, qty: 6 }],
      packedById: salesmanId,
    });
    shipmentIds.push(shipmentId);
    await expect(
      prisma.$transaction((tx) =>
        issueKonsiTransfer(tx, {
          order: { id: order.id, storeId: order.storeId, lines: [{ id: line.id, itemId: line.itemId, variantSku: line.variantSku, productName: line.productName, qty: 0 }] },
          shipmentId,
          transferredById: salesmanId,
        }),
      ),
    ).rejects.toBeInstanceOf(KonsiTransferReservationMismatchError);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });

  it("links the transfer to its shipment and keeps orderLineId provenance", async () => {
    const { shipmentId } = await transferVia(orderId);
    const t = await prisma.konsiTransfer.findFirstOrThrow({ where: { orderId: seededId(orderId) }, include: { lines: true } });
    expect(t.shipmentId).toBe(shipmentId);
    expect(t.docNo.startsWith("KTRF/")).toBe(true);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].orderLineId).toBe(lineId);
    expect(Number(t.lines[0].qty)).toBe(6);
  });

  it("creates StoreStock at the transferred qty and cost on a first transfer into an empty store", async () => {
    await transferVia(orderId);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(6);
    expect(Number(ss.avgCost)).toBe(10_000);
  });

  it("blends rather than overwrites on a second transfer into a non-empty store", async () => {
    /* first transfer 6 @ 10.000, then a second order of 6 against inventory re-stocked at 20.000 */
    await transferVia(orderId);
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.update({ where: { id: inv.id }, data: { avgCost: 20_000 } });
    await transferVia(secondOrderId);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(12);
    expect(Number(ss.avgCost)).toBe(15_000);
  });

  it("writes a NEGATIVE StockAdjustment sourced KONSI_TRANSFER", async () => {
    await transferVia(orderId);
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "KONSI_TRANSFER" } });
    expect(adj.type).toBe("NEGATIVE");
    expect(Number(adj.qtyChange)).toBe(-6);
  });

  it('writes "" into StoreStock for a variantless line while reading the null InventoryValue row', async () => {
    /* the fixture's inventory row is seeded with variantSku: null */
    await transferVia(variantlessOrderId);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(variantlessItemId) } });
    expect(ss.variantSku).toBe("");
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(variantlessItemId) } });
    expect(inv.variantSku).toBeNull();
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(variantlessItemId) } })).toBe(1);
  });

  it("moves nothing when a line is short — the existing reserve guard still aborts", async () => {
    /*
     * Approve no longer transfers anything, so this pins the reserve half alone: the guarded
     * reserve refuses the short order, and the approval rolls back with nothing reserved — the
     * reservedQty assertion is the one that proves it — and nothing moved into the store.
     */
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    await expect(approveFieldSalesOrder({ orderId: shortOrderId, approvedById: salesmanId })).rejects.toBeInstanceOf(InsufficientStockError);
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty));
    expect(await prisma.storeStock.count({ where: { storeId: seededId(storeId), itemId: seededId(shortItemId) } })).toBe(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(shortOrderId) } })).toBe(0);
  });

  it("re-approving an APPROVED order creates no transfer and no second reservation", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty) + 6);
  });

  it("clamps a negative StoreStock qty to 0 for the avgCost blend rather than inflating it", async () => {
    /*
     * A konsi retur can drive a StoreStock row negative by design (approve-writer.ts) — here the
     * store's row already reads -6 @ avgCost 0 before this transfer lands 10 units @ 10.000.
     * Unguarded, weightedAvgCost(-6, 0, 10, 10000) = (-6*0 + 10*10000) / (-6+10) = 100000/4 =
     * 25.000, 2.5x the true incoming cost. Clamping the negative qty to 0 for the blend makes the
     * incoming cost become the new average outright (100000/10 = 10.000), while the actual qty
     * written still uses the real -6 (-6 + 10 = 4), not the clamped one.
     */
    await prisma.storeStock.create({
      data: { storeId: seededId(storeId), itemId: seededId(negativeItemId), variantSku: "", qty: -6, avgCost: 0 },
    });
    await transferVia(negativeOrderId);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(negativeItemId) } });
    expect(Number(ss.qty)).toBe(4);
    expect(Number(ss.avgCost)).toBe(10_000);
  });
});
