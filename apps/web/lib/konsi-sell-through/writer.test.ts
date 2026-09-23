import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { createSellThrough, resolveSellThroughLine, approveSellThrough, cancelSellThrough } from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("konsi sell-through writer (test bed only)", () => {
  /**
   * Fixture helpers. The ledger is built only through the real writers — konsi order approve →
   * shipment → completion for stock in, recordSpgSale for POS, and the store stocktake writer for
   * the closing count — so every StockLedgerEntry the report derives from is authentic.
   */
  const token = Math.random().toString(36).slice(2, 10);
  let runCounter = 0;
  let run = "";
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let visitId = "";
  let orderIds: string[] = [];

  beforeEach(async () => {
    run = "";
    uomId = "";
    itemId = "";
    storeId = "";
    userId = "";
    visitId = "";
    orderIds = [];
    run = `${token}-${++runCounter}`;

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSTW-${run}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KSTW-${run}`, nameId: "Sell-through item", nameEn: "Sell-through item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;
    /* avgCost 10000 at main is what the konsi transfer carries onto StoreStock.avgCost — the line's unitCost snapshot. */
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 10000, totalValue: 500000 } });

    /* sellThroughMethod starts null; each case sets the method it exercises. */
    const store = await prisma.store.create({
      data: {
        code: `TEST-KSTW-STORE-${run}`,
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
    storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-kstw-${run}@example.com`, name: "Test Sell-through User" } });
    userId = user.id;

    const visit = await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: -6.2, checkinLng: 106.8 } });
    visitId = visit.id;
  });

  afterEach(async () => {
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
      .filter((n) => orderIds.includes((n.metadata as { orderId?: string } | null)?.orderId ?? ""))
      .map((n) => n.id);
    if (leakedNotifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: leakedNotifIds } } });

    const seededOrderIds = orderIds.map((id) => seededId(id));

    await prisma.konsiSellThroughLine.deleteMany({ where: { sellThrough: { storeId: seededId(storeId) } } });
    await prisma.konsiSellThrough.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktake: { storeId: seededId(storeId) } } });
    await prisma.storeStocktake.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSale: { storeId: seededId(storeId) } } });
    await prisma.spgSale.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    /**
     * Transfers BEFORE shipments: deleting several shipments that each hold a transfer trips
     * Prisma's emulated 1:1 relation check ("Expected zero or one element, got 2").
     */
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: seededOrderIds } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededOrderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /**
   * Ledger createdAt is millisecond-precision, so two writers a few ms apart can stamp the same
   * instant. Used wherever a later movement must land strictly after a stocktake's boundary.
   */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

  const setMethod = (method: "SPG_POS" | "SHELF_COUNT" | null) =>
    prisma.store.update({ where: { id: storeId }, data: { sellThroughMethod: method } });

  /* One konsi order moved into the store: approve reserves, completion writes the KonsiTransfer store row (+qty). */
  const transferIn = async (qty: number) => {
    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId: userId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "Sell-through line", qty, unitPrice: 0 }],
    });
    orderIds.push(orderId);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    const orderLine = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });

    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: orderLine.id, qty }],
      packedById: userId,
    });
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `RESI-${run}-${orderIds.length}` });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
      lines: [{ shipmentLineId: shipment.lines[0].id, deliveredQty: qty }],
    });
  };

  /* One POS sale at the store: writes the SpgSale store row (−qty). */
  const spgSell = async (qty: number) => {
    const res = await recordSpgSale({ salesmanId: userId, storeId, lines: [{ itemId, variantSku: null, qty }] });
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
    const { id } = await createStoreStocktake({ storeId, createdById: userId, countedAt: new Date() });
    const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: seededId(id) }, select: { id: true } });
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: lines.map((l) => ({ lineId: l.id, countedQty, cause: opts.cause ?? null, reason: opts.reason ?? null })),
      submit: true,
      userId,
    });
    if (opts.approve !== false) await approveStoreStocktake({ stocktakeId: id, approvedById: userId });
    return id;
  };

  const onlyLine = (sellThroughId: string) =>
    prisma.konsiSellThroughLine.findFirstOrThrow({ where: { sellThroughId: seededId(sellThroughId) } });

  /* create — preconditions */

  it("refuses NOT_FOUND for a stocktake that does not exist", async () => {
    await expect(createSellThrough({ closingStocktakeId: `missing-${run}`, createdById: userId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  it("refuses STOCKTAKE_NOT_APPROVED for a submitted count that was never approved", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6, { approve: false });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({ code: "STOCKTAKE_NOT_APPROVED" });
  }, SLOW);

  it("refuses NOT_FULL_COUNT for an approved count that left a line uncounted", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(null);
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({ code: "NOT_FULL_COUNT" });
  }, SLOW);

  it("refuses NOT_KONSI when the store is no longer a consignment store", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    /* Direct flip for the test only — the store edit writer would also clear the method; left set here so NOT_KONSI is the only failing precondition. */
    await prisma.store.update({ where: { id: storeId }, data: { termsType: "PUTUS" } });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({ code: "NOT_KONSI" });
  }, SLOW);

  it("refuses METHOD_NOT_SET for a KONSI store with no sell-through method", async () => {
    await transferIn(6);
    const stocktakeId = await count(6);
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({ code: "METHOD_NOT_SET" });
  }, SLOW);

  it("refuses ALREADY_USED for a stocktake that already closes a report", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({ code: "ALREADY_USED" });
  }, SLOW);

  it("refuses DRAFT_EXISTS while an earlier report of the store is still DRAFT", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await count(6);
    await createSellThrough({ closingStocktakeId: first, createdById: userId });
    await tick();
    const second = await count(6);
    await expect(createSellThrough({ closingStocktakeId: second, createdById: userId })).rejects.toMatchObject({ code: "DRAFT_EXISTS" });
  }, SLOW);

  it("refuses OUT_OF_ORDER for a stocktake approved before the previous report's closing stocktake", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Both counts match the ledger (6 of 6), so neither writes a row and each boundary is its approvedAt: earlier < later. */
    const earlier = await count(6);
    await tick();
    const later = await count(6);
    const report = await createSellThrough({ closingStocktakeId: later, createdById: userId });
    await approveSellThrough({ id: report.id, approvedById: userId });
    await expect(createSellThrough({ closingStocktakeId: earlier, createdById: userId })).rejects.toMatchObject({ code: "OUT_OF_ORDER" });
  }, SLOW);

  it("refuses UNKNOWN_REF_TYPE for a store ledger row outside the classified set, naming the refType", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { approvedAt } = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) }, select: { approvedAt: true } });
    /* Inserted directly — no real writer produces an unclassified refType — one second inside the window. */
    await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId,
        variantSku: "",
        type: "ADJUSTMENT",
        qty: 1,
        balanceQty: 7,
        refType: "LegacyMystery",
        refId: `TEST-KSTW-MYSTERY-${run}`,
        refDocNumber: `MYSTERY/${run}`,
        createdAt: new Date(approvedAt!.getTime() - 1000),
      },
    });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId })).rejects.toMatchObject({
      code: "UNKNOWN_REF_TYPE",
      detail: "LegacyMystery",
    });
  }, SLOW);

  /* SHELF_COUNT */

  it("SHELF_COUNT: 6 transferred in, 2 counted → one line billed 4, and approve succeeds with no resolution", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Expected 6, counted 2 → the stocktake writes a −4 store row, i.e. gapQty 4. */
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });

    const { id, docNo } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    expect(docNo.startsWith("SLT/")).toBe(true);

    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) }, include: { lines: true } });
    const ownRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(storeId), refType: "StoreStocktake", refId: seededId(stocktakeId) },
      orderBy: { createdAt: "desc" },
    });
    expect(doc.status).toBe("DRAFT");
    expect(doc.method).toBe("SHELF_COUNT");
    expect(doc.storeId).toBe(storeId);
    expect(doc.closingStocktakeId).toBe(stocktakeId);
    expect(doc.stocktakeKey).toBe(stocktakeId);
    expect(doc.chainKey).toBe(`${storeId}:root`);
    expect(doc.previousId).toBeNull();
    expect(doc.periodStart).toBeNull();
    expect(doc.periodEnd.toISOString()).toBe(ownRow.createdAt.toISOString());
    expect(doc.lines).toHaveLength(1);

    /* opening 0 + in 6 − out 0 − pos 0 − gap 4 = closing 2; billed = opening + in − out − counted = 0 + 6 − 0 − 2 = 4. */
    const line = doc.lines[0];
    expect(line.itemId).toBe(itemId);
    expect(line.variantSku).toBe("");
    expect(line.productName).toBe("Sell-through item");
    expect(Number(line.openingQty)).toBe(0);
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.outQty)).toBe(0);
    expect(Number(line.posSoldQty)).toBe(0);
    expect(Number(line.gapQty)).toBe(4);
    expect(Number(line.closingQty)).toBe(2);
    expect(Number(line.countedQty)).toBe(2);
    expect(Number(line.billedQty)).toBe(4);
    expect(Number(line.shrinkageQty)).toBe(0);
    expect(line.negativeSold).toBe(false);
    expect(line.suggestedResolution).toBeNull();
    expect(line.resolution).toBeNull();
    expect(Number(line.unitCost)).toBe(10000);

    await approveSellThrough({ id, approvedById: userId });
    const approved = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(userId);
    expect(approved.approvedAt).not.toBeNull();
  }, SLOW);

  /* SPG_POS — hold and resolution */

  it("SPG_POS: POS sells 3 and the count finds 2 more gone → prefilled SHRINKAGE, HELD until resolved, then approves", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    /* StoreStock 6 − 3 = 3 expected; counted 1 → −2 store row, gapQty 2. */
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });

    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    const line = await onlyLine(id);
    /* opening 0 + in 6 − out 0 − pos 3 − gap 2 = closing 1; billed starts at POS 3. */
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.posSoldQty)).toBe(3);
    expect(Number(line.gapQty)).toBe(2);
    expect(Number(line.closingQty)).toBe(1);
    expect(Number(line.countedQty)).toBe(1);
    expect(Number(line.billedQty)).toBe(3);
    expect(line.suggestedResolution).toBe("SHRINKAGE");
    expect(line.resolution).toBeNull();

    await expect(approveSellThrough({ id, approvedById: userId })).rejects.toMatchObject({ code: "HELD" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");

    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed theft", userId });
    const resolved = await onlyLine(id);
    /* SHRINKAGE keeps billed at POS 3 and books the gap 2 as Elorae's loss. */
    expect(resolved.resolution).toBe("SHRINKAGE");
    expect(resolved.resolutionReason).toBe("confirmed theft");
    expect(Number(resolved.billedQty)).toBe(3);
    expect(Number(resolved.shrinkageQty)).toBe(2);

    await approveSellThrough({ id, approvedById: userId });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");
  }, SLOW);

  it("resolve refuses a missing reason, the wrong arm, an over-long reason, an unknown line and a non-DRAFT report", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    const line = await onlyLine(id);

    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "   ", userId })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    /* A shortfall (gap 2 > 0) resolves only as BILL or SHRINKAGE; BILL_POS is the surplus arm. */
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "BILL_POS", reason: null, userId })).rejects.toMatchObject({ code: "INVALID_RESOLUTION" });
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "x".repeat(1001), userId })).rejects.toMatchObject({
      code: "INVALID_RESOLUTION",
      detail: "REASON_TOO_LONG",
    });
    await expect(resolveSellThroughLine({ lineId: `missing-${run}`, resolution: "BILL", reason: null, userId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await onlyLine(id);
    expect(untouched.resolution).toBeNull();
    expect(Number(untouched.billedQty)).toBe(3);

    /* BILL: billed = POS 3 + gap 2 = 5. */
    await resolveSellThroughLine({ lineId: line.id, resolution: "BILL", reason: null, userId });
    expect(Number((await onlyLine(id)).billedQty)).toBe(5);

    await approveSellThrough({ id, approvedById: userId });
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "too late", userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  }, SLOW);

  /* approve — STALE and CAS */

  it("approve refuses STALE when a movement lands inside the window after the report was created", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });

    /**
     * The real writer stamps the sale "now", after the boundary. Its ledger row is moved one
     * second inside the window — test-only — to stand in for a movement that belongs to the
     * period but committed after creation (a late-approved retur, say). Recomputed: pos 1,
     * closing 0 + 6 − 0 − 1 − 4 = 1, against the stored pos 0 / closing 2.
     */
    const saleId = await spgSell(1);
    const saleRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(storeId), refType: "SpgSale", refId: seededId(saleId) },
    });
    await prisma.stockLedgerEntry.update({ where: { id: saleRow.id }, data: { createdAt: new Date(doc.periodEnd.getTime() - 1000) } });

    await expect(approveSellThrough({ id, approvedById: userId })).rejects.toMatchObject({ code: "STALE" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");
  }, SLOW);

  it("a second approve of the same report refuses INVALID_STATE", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    await approveSellThrough({ id, approvedById: userId });
    await expect(approveSellThrough({ id, approvedById: userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  }, SLOW);

  /* chain */

  it("chains: report 2's openings equal report 1's closingQty and its period starts at report 1's end", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Report 1: opening 0 + in 6 − gap 4 = closing 2. */
    const first = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const r1 = await createSellThrough({ closingStocktakeId: first, createdById: userId });
    await approveSellThrough({ id: r1.id, approvedById: userId });
    const r1Doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r1.id) }, include: { lines: true } });
    expect(Number(r1Doc.lines[0].closingQty)).toBe(2);

    await tick();
    await spgSell(1);
    await tick();
    /**
     * StoreStock 2 − 1 = 1 expected, counted 1: an unchanged line writes no ledger row, so this
     * stocktake's boundary falls back to its approvedAt.
     */
    const second = await count(1);
    const r2 = await createSellThrough({ closingStocktakeId: second, createdById: userId });
    const r2Doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r2.id) }, include: { lines: true } });
    expect(r2Doc.previousId).toBe(r1.id);
    expect(r2Doc.chainKey).toBe(`${storeId}:${r1.id}`);
    expect(r2Doc.periodStart?.toISOString()).toBe(r1Doc.periodEnd.toISOString());
    expect(r2Doc.lines).toHaveLength(1);

    /* opening 2 (report 1's closing) + in 0 − out 0 − pos 1 − gap 0 = closing 1; SHELF_COUNT billed = 2 + 0 − 0 − 1 = 1. */
    const line = r2Doc.lines[0];
    expect(Number(line.openingQty)).toBe(Number(r1Doc.lines[0].closingQty));
    expect(Number(line.inQty)).toBe(0);
    expect(Number(line.posSoldQty)).toBe(1);
    expect(Number(line.gapQty)).toBe(0);
    expect(Number(line.closingQty)).toBe(1);
    expect(Number(line.billedQty)).toBe(1);

    await approveSellThrough({ id: r2.id, approvedById: userId });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r2.id) } })).status).toBe("APPROVED");
  }, SLOW);

  /* cancel */

  it("cancel requires a reason, frees the closing stocktake for a new report, and refuses a second cancel", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const first = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });

    await expect(cancelSellThrough({ id: first.id, cancelledById: userId, reason: "   " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });

    await cancelSellThrough({ id: first.id, cancelledById: userId, reason: "  wrong count  " });
    const cancelled = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(first.id) } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledById).toBe(userId);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelReason).toBe("wrong count");
    expect(cancelled.stocktakeKey).toBeNull();
    expect(cancelled.chainKey).toBeNull();
    expect(cancelled.closingStocktakeId).toBe(stocktakeId);

    await expect(cancelSellThrough({ id: first.id, cancelledById: userId, reason: "again" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const second = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: userId });
    expect(second.id).not.toBe(first.id);
    const recreated = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(second.id) } });
    expect(recreated.status).toBe("DRAFT");
    expect(recreated.stocktakeKey).toBe(stocktakeId);
    expect(recreated.chainKey).toBe(`${storeId}:root`);
  }, SLOW);
});
