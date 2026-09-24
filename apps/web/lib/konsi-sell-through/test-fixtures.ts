import { prisma, seededId } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "@/lib/field-sales/writer";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
} from "@/lib/delivery/shipment-writer";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake } from "@/lib/stores/stocktake/writer";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { receiveFieldReturn } from "@/lib/field-sales/retur/receive-writer";
import { approveFieldReturn } from "@/lib/field-sales/retur/approve-writer";

export type SellThroughFixtureState = {
  run: string;
  uomId: string;
  itemId: string;
  storeId: string;
  userId: string;
  visitId: string;
  orderIds: string[];
};

/**
 * Shared fixture for `writer.test.ts` and `queries.test.ts`. The ledger is built only through the
 * real writers — konsi order approve → shipment → completion for stock in, recordSpgSale for POS,
 * and the store stocktake writer for the closing count — so every StockLedgerEntry the report
 * derives from is authentic.
 *
 * `state` is one mutable object shared by every helper below and by the caller's test bodies —
 * `beforeEach` resets its fields in place (never reassigns `state` itself), so a spec can read
 * `state.storeId` etc. straight through a full run without re-destructuring.
 */
export function createSellThroughFixtures() {
  const token = Math.random().toString(36).slice(2, 10);
  let runCounter = 0;
  const state: SellThroughFixtureState = {
    run: "",
    uomId: "",
    itemId: "",
    storeId: "",
    userId: "",
    visitId: "",
    orderIds: [],
  };

  async function beforeEach() {
    state.run = "";
    state.uomId = "";
    state.itemId = "";
    state.storeId = "";
    state.userId = "";
    state.visitId = "";
    state.orderIds = [];
    state.run = `${token}-${++runCounter}`;

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSTW-${state.run}`, nameId: "pcs", nameEn: "pcs" } });
    state.uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-KSTW-${state.run}`,
        nameId: "Sell-through item",
        nameEn: "Sell-through item",
        type: "FINISHED_GOOD",
        uomId: state.uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    state.itemId = item.id;
    /* avgCost 10000 at main is what the konsi transfer carries onto StoreStock.avgCost — the line's unitCost snapshot. */
    await prisma.inventoryValue.create({ data: { itemId: state.itemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 10000, totalValue: 500000 } });

    /* sellThroughMethod starts null; each case sets the method it exercises. */
    const store = await prisma.store.create({
      data: {
        code: `TEST-KSTW-STORE-${state.run}`,
        name: "Test Sell-through Store",
        address: "Test address",
        termsType: "KONSI",
        marginPercent: 20,
        isActive: true,
        lat: -6.2,
        lng: 106.8,
        checkinRadiusMeters: 100,
      },
    });
    state.storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-kstw-${state.run}@example.com`, name: "Test Sell-through User" } });
    state.userId = user.id;

    const visit = await prisma.storeVisit.create({ data: { storeId: state.storeId, userId: state.userId, checkinLat: -6.2, checkinLng: 106.8 } });
    state.visitId = visit.id;
  }

  async function afterEach() {
    /**
     * createFieldSalesOrder writes one AdminNotification per order with no orderId column to
     * filter on (only a Json metadata blob), so the category's rows are matched in JS against our
     * own seeded order ids and deleted by that explicit id list — never by category alone.
     */
    const candidateNotifs = await prisma.adminNotification.findMany({
      where: { category: "PENDING_ORDER_APPROVAL" },
      select: { id: true, metadata: true },
    });
    const leakedNotifIds = candidateNotifs
      .filter((n) => state.orderIds.includes((n.metadata as { orderId?: string } | null)?.orderId ?? ""))
      .map((n) => n.id);
    if (leakedNotifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: leakedNotifIds } } });

    const seededOrderIds = state.orderIds.map((id) => seededId(id));

    await prisma.konsiSellThroughLine.deleteMany({ where: { sellThrough: { storeId: seededId(state.storeId) } } });
    await prisma.konsiSellThrough.deleteMany({ where: { storeId: seededId(state.storeId) } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnDoc: { storeId: seededId(state.storeId) } } });
    await prisma.fieldReturn.deleteMany({ where: { storeId: seededId(state.storeId) } });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktake: { storeId: seededId(state.storeId) } } });
    await prisma.storeStocktake.deleteMany({ where: { storeId: seededId(state.storeId) } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSale: { storeId: seededId(state.storeId) } } });
    await prisma.spgSale.deleteMany({ where: { storeId: seededId(state.storeId) } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(state.itemId) } });
    /**
     * Transfers BEFORE shipments: deleting several shipments that each hold a transfer trips
     * Prisma's emulated 1:1 relation check ("Expected zero or one element, got 2").
     */
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: seededId(state.itemId) } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: seededOrderIds } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(state.storeId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(state.itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(state.itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(state.itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededOrderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(state.itemId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(state.visitId) } });
    await prisma.item.deleteMany({ where: { id: seededId(state.itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(state.storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(state.uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(state.userId) } });
  }

  /**
   * Ledger createdAt is millisecond-precision, so two writers a few ms apart can stamp the same
   * instant. Used wherever a later movement must land strictly after a stocktake's boundary.
   */
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

  const setMethod = (method: "SPG_POS" | "SHELF_COUNT" | null) =>
    prisma.store.update({ where: { id: state.storeId }, data: { sellThroughMethod: method } });

  /* One konsi order moved into the store: approve reserves, completion writes the KonsiTransfer store row (+qty). */
  const transferIn = async (qty: number) => {
    const { orderId } = await createFieldSalesOrder({
      storeId: state.storeId,
      salesmanId: state.userId,
      visitId: state.visitId,
      lines: [{ itemId: state.itemId, variantSku: "", productName: "Sell-through line", qty, unitPrice: 0 }],
    });
    state.orderIds.push(orderId);
    await approveFieldSalesOrder({ orderId, approvedById: state.userId });
    const orderLine = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });

    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: orderLine.id, qty }],
      packedById: state.userId,
    });
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `RESI-${state.run}-${state.orderIds.length}` });
    await shipDeliveryShipment({ shipmentId, shippedById: state.userId });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: state.userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
      lines: [{ shipmentLineId: shipment.lines[0].id, deliveredQty: qty }],
    });
  };

  /* One POS sale at the store: writes the SpgSale store row (−qty). */
  const spgSell = async (qty: number) => {
    const res = await recordSpgSale({ salesmanId: state.userId, storeId: state.storeId, lines: [{ itemId: state.itemId, variantSku: null, qty }] });
    if (!res.ok) throw new Error(`recordSpgSale refused the fixture sale: ${res.code}`);
    return res.spgSaleId;
  };

  /**
   * One store count over every line the document opened with (the fixture store only ever holds
   * the one item). `countedQty: null` leaves it uncounted, which approval records as a partial
   * count. A shortfall needs a cause and every variance needs a reason, per the stocktake writer.
   */
  const count = async (
    countedQty: number | null,
    opts: { cause?: "SHRINKAGE" | "UNRECORDED_SALE"; reason?: string; approve?: boolean } = {},
  ) => {
    const { id } = await createStoreStocktake({ storeId: state.storeId, createdById: state.userId, countedAt: new Date() });
    const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: seededId(id) }, select: { id: true } });
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: lines.map((l) => ({ lineId: l.id, countedQty, cause: opts.cause ?? null, reason: opts.reason ?? null })),
      submit: true,
      userId: state.userId,
    });
    if (opts.approve !== false) await approveStoreStocktake({ stocktakeId: id, approvedById: state.userId });
    return id;
  };

  /* One FIELD retur raised at the store: the goods leave the shelf now, but StoreStock only drops when it is approved. */
  const raiseRetur = async (qty: number) => {
    const { returnId, docNo } = await createFieldReturn({
      storeId: state.storeId,
      raisedById: state.userId,
      origin: "FIELD",
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://r2.example/nota.jpg",
      notaPhotoR2Key: `field-return-notas/${state.run}/nota.jpg`,
      lines: [{ itemId: state.itemId, variantSku: "", qty, reason: "UNSOLD" }],
    });
    return { returnId, docNo };
  };

  /* Receives the retur in full and approves it, which writes its FieldReturn store row (−qty). */
  const settleRetur = async (returnId: string) => {
    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(returnId) }, select: { id: true, qty: true } });
    await receiveFieldReturn({
      returnId,
      receivedById: state.userId,
      counts: lines.map((l) => ({ lineId: l.id, receivedQty: l.qty, sellableQty: l.qty, rejectedQty: 0 })),
    });
    await approveFieldReturn({ returnId, approvedById: state.userId });
  };

  const onlyLine = (sellThroughId: string) =>
    prisma.konsiSellThroughLine.findFirstOrThrow({ where: { sellThroughId: seededId(sellThroughId) } });

  return { state, beforeEach, afterEach, tick, setMethod, transferIn, spgSell, count, raiseRetur, settleRetur, onlyLine };
}

export type SellThroughFixtures = ReturnType<typeof createSellThroughFixtures>;
