import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listKonsiAssortmentGaps, listKonsiSuggestions } from "./queries";
import { listAssortmentGaps } from "@/lib/stores/assortment/queries";
import { approveFieldSalesOrder } from "./writer";
import { closeFieldSalesOrderRemainder } from "./delivery/writer";
import { openKonsiQtyByKey } from "./konsi-open-qty";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
} from "@/lib/delivery/shipment-writer";

/* Read-only against a shared dev DB, but the fixture still writes rows — keep the same guard as sibling specs. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listKonsiAssortmentGaps (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let userId = "";
  let storeId = "";
  let putusStoreId = "";
  let prevSentItemId = "";
  let variantItemId = "";
  let targetItemId = "";
  let overlapItemId = "";
  let zeroAvailItemId = "";
  let dualRowItemId = "";
  let openGapItemId = "";
  let partialGapItemId = "";
  let orderId = "";
  let priorOrderId = "";
  let putusOrderId = "";
  let openGapOrderId = "";
  let partialGapOrderId = "";
  const assortmentLineIds: string[] = [];
  const storeStockIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    userId = "";
    storeId = "";
    putusStoreId = "";
    prevSentItemId = "";
    variantItemId = "";
    targetItemId = "";
    overlapItemId = "";
    zeroAvailItemId = "";
    dualRowItemId = "";
    openGapItemId = "";
    partialGapItemId = "";
    orderId = "";
    priorOrderId = "";
    putusOrderId = "";
    openGapOrderId = "";
    partialGapOrderId = "";
    assortmentLineIds.length = 0;
    storeStockIds.length = 0;

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KAG-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `test-kag-${token}@example.com`, name: "Test KAG Admin" } });
    userId = user.id;

    /*
     * Deliberately NOT "TEST-"-prefixed: apps/web/app/pwa/stores/actions.spec.ts runs a
     * pre-existing `store.deleteMany({ code: { startsWith: "TEST-" } })` teardown that sweeps the
     * WHOLE shared dev DB, not just its own fixtures. A "TEST-"-prefixed code here would sit in
     * that blast radius.
     */
    const store = await prisma.store.create({
      data: { code: `KAG-STORE-${token}`, name: "Test Assortment Gap Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    const putusStore = await prisma.store.create({
      data: { code: `KAG-PSTORE-${token}`, name: "Test Putus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    /**
     * On the assortment, sent to this store before, and currently holds nothing — the exact case
     * the gap signal exists to catch, and the case `listKonsiSuggestions` MUST have already
     * dropped via `sentItemIds`.
     */
    const prevSentItem = await prisma.item.create({
      data: { sku: `TEST-KAG-PS-${token}`, nameId: "Previously sent, now gapped", nameEn: "Previously sent, now gapped", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 },
    });
    prevSentItemId = prevSentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: prevSentItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    const line = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: prevSentItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(line.id);

    /**
     * Two-variant item, both on the assortment. V1 will be on the order under approval (so its
     * gap must be excluded); V2 is not on the order (so its gap must still show). Neither variant
     * was ever sent, so `listKonsiSuggestions` drops the WHOLE item (item-grain onOrder exclusion)
     * — leaving no overlap to worry about for this pair.
     */
    const variantItem = await prisma.item.create({
      data: { sku: `TEST-KAG-VAR-${token}`, nameId: "Variant gap item", nameEn: "Variant gap item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    variantItemId = variantItem.id;
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "V1", qtyOnHand: 5, reservedQty: 0, avgCost: 800, totalValue: 4000 } });
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "V2", qtyOnHand: 8, reservedQty: 0, avgCost: 800, totalValue: 6400 } });
    const lineV1 = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: variantItemId, variantSku: "V1", targetQty: null, createdById: userId },
    });
    const lineV2 = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: variantItemId, variantSku: "V2", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineV1.id, lineV2.id);

    /* Depleted-but-not-missing gap, with a numeric target, to check `onHandQty`/`targetQty` pass through untouched. */
    const targetItem = await prisma.item.create({
      data: { sku: `TEST-KAG-TGT-${token}`, nameId: "Target gap item", nameEn: "Target gap item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 15000 },
    });
    targetItemId = targetItem.id;
    await prisma.inventoryValue.create({ data: { itemId: targetItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 500, totalValue: 10000 } });
    const lineTarget = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: targetItemId, variantSku: "", targetQty: 5, createdById: userId },
    });
    assortmentLineIds.push(lineTarget.id);
    const stockTarget = await prisma.storeStock.create({
      data: { storeId, itemId: targetItemId, variantSku: "", qty: 1 },
    });
    storeStockIds.push(stockTarget.id);

    /**
     * On the assortment, NEVER sent, not on any order, with real main-warehouse stock — the case
     * that used to render under BOTH headings before `listKonsiSuggestions` learned to suppress a
     * row already claimed by a gap. Deliberately kept separate from `prevSentItemId`/`targetItemId`
     * above, which are excluded from never-sent via `sentItemIds` regardless of that fix — this
     * item is excluded ONLY by the gap-suppression filter, so it is the one that actually proves
     * the fix does something.
     */
    const overlapItem = await prisma.item.create({
      data: { sku: `TEST-KAG-OVL-${token}`, nameId: "Never sent, also a gap", nameEn: "Never sent, also a gap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 12000 },
    });
    overlapItemId = overlapItem.id;
    await prisma.inventoryValue.create({ data: { itemId: overlapItemId, variantSku: "", qtyOnHand: 6, reservedQty: 0, avgCost: 600, totalValue: 3600 } });
    const lineOverlap = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: overlapItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineOverlap.id);

    /**
     * A genuine gap (never received, target "must be present") whose main-warehouse row has
     * `qtyOnHand === reservedQty`, so `available` is exactly 0 — the availability filter's
     * boundary. `listKonsiAssortmentGaps` drops it (nothing stageable from this panel); the
     * store-card surface via `listAssortmentGaps` must still show it regardless of main-warehouse
     * stock.
     */
    const zeroAvailItem = await prisma.item.create({
      data: { sku: `TEST-KAG-ZERO-${token}`, nameId: "Genuine gap, zero available", nameEn: "Genuine gap, zero available", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 18000 },
    });
    zeroAvailItemId = zeroAvailItem.id;
    await prisma.inventoryValue.create({ data: { itemId: zeroAvailItemId, variantSku: "", qtyOnHand: 4, reservedQty: 4, avgCost: 400, totalValue: 1600 } });
    const lineZero = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: zeroAvailItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineZero.id);

    /**
     * MariaDB permits multiple NULLs on the (itemId, variantSku) unique index, so an item can
     * carry both a `null` and an `""` InventoryValue row for the same logical (variantless) SKU.
     * Both normalize to the gap's own `""` key, and the fold must keep the MINIMUM available
     * across the collision (10 vs 3 -> 3), never the sum (13) and never just one row picked
     * arbitrarily.
     */
    const dualRowItem = await prisma.item.create({
      data: { sku: `TEST-KAG-DUAL-${token}`, nameId: "Dual null/empty variant row item", nameEn: "Dual null/empty variant row item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 25000 },
    });
    dualRowItemId = dualRowItem.id;
    await prisma.inventoryValue.create({ data: { itemId: dualRowItemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 700, totalValue: 7000 } });
    await prisma.inventoryValue.create({ data: { itemId: dualRowItemId, variantSku: "", qtyOnHand: 3, reservedQty: 0, avgCost: 700, totalValue: 2100 } });
    const lineDual = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: dualRowItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineDual.id);

    /**
     * On the assortment, approved as a KONSI order for this store but not yet delivered — approve
     * now only RESERVES konsi stock, so this never lands on `StoreStock` until a delivery shipment
     * completes it. `openKonsiQtyByKey` is what stops this from reading as a gap while the units
     * are in transit; closing the order's remainder (below) is what makes the gap reappear once
     * they never arrive.
     */
    const openGapItem = await prisma.item.create({
      data: { sku: `TEST-KAG-OPEN-${token}`, nameId: "In-transit konsi item", nameEn: "In-transit konsi item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 22000 },
    });
    openGapItemId = openGapItem.id;
    await prisma.inventoryValue.create({ data: { itemId: openGapItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 900, totalValue: 18000 } });
    const lineOpenGap = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: openGapItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineOpenGap.id);
    const openGapOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-OPEN-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 6000,
        total: 6000,
        lines: {
          create: [{ itemId: openGapItemId, variantSku: "", productName: "In-transit konsi item", qty: 6, unitPrice: 1000, lineTotal: 6000 }],
        },
      },
    });
    openGapOrderId = openGapOrder.id;
    await approveFieldSalesOrder({ orderId: openGapOrderId, approvedById: userId });

    /**
     * A target the in-transit qty alone still doesn't meet (target 10, approved-but-undelivered
     * 6, physical 0) — a genuine gap that ALSO has units in transit, so the row exposes both
     * `onHandQty` (physical, must read 0) and `inTransitQty` (must read 6) rather than one
     * pre-summed figure that would hide which part is actually on the shelf.
     */
    const partialGapItem = await prisma.item.create({
      data: { sku: `TEST-KAG-PARTIAL-${token}`, nameId: "Partially in-transit gap item", nameEn: "Partially in-transit gap item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 17000 },
    });
    partialGapItemId = partialGapItem.id;
    await prisma.inventoryValue.create({ data: { itemId: partialGapItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 850, totalValue: 17000 } });
    const linePartialGap = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: partialGapItemId, variantSku: "", targetQty: 10, createdById: userId },
    });
    assortmentLineIds.push(linePartialGap.id);
    const partialGapOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-PARTIAL-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 6000,
        total: 6000,
        lines: {
          create: [{ itemId: partialGapItemId, variantSku: "", productName: "Partially in-transit gap item", qty: 6, unitPrice: 1000, lineTotal: 6000 }],
        },
      },
    });
    partialGapOrderId = partialGapOrder.id;
    await approveFieldSalesOrder({ orderId: partialGapOrderId, approvedById: userId });

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: variantItemId, variantSku: "V1", productName: "Variant gap item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    orderId = order.id;

    /**
     * A separate, already-APPROVED konsi order that sent BOTH `prevSentItemId` and `targetItemId`
     * to this store. `targetItemId` must be sent-before too, not just `prevSentItemId`: otherwise
     * it would be a genuinely never-sent item that ALSO happens to be an assortment gap — a case
     * `overlapItemId` above now exists to cover on its own, so it must not sneak into THIS fixture
     * and re-cover the same ground for the wrong reason.
     */
    const priorOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-PRIOR-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 2000,
        total: 2000,
        lines: {
          create: [
            /* deliveredQty: qty — this order represents STOCK ALREADY DELIVERED and since consumed
             * back down to the gap this fixture tests, never units still in transit. Left at the
             * default 0, openKonsiQtyByKey would (correctly, per its own contract) count these as
             * still-outstanding konsi qty and net them into onHandQty, masking the very gap this
             * fixture exists to prove. */
            { itemId: prevSentItemId, variantSku: "", productName: "Previously sent, now gapped", qty: 1, deliveredQty: 1, unitPrice: 1000, lineTotal: 1000 },
            { itemId: targetItemId, variantSku: "", productName: "Target gap item", qty: 1, deliveredQty: 1, unitPrice: 1000, lineTotal: 1000 },
          ],
        },
      },
    });
    priorOrderId = priorOrder.id;

    const putusOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-KAG-${token}`,
        orderType: "PUTUS",
        storeId: putusStoreId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: prevSentItemId, variantSku: "", productName: "Previously sent, now gapped", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    putusOrderId = putusOrder.id;
  });

  afterEach(async () => {
    const allItemIds = [
      seededId(prevSentItemId),
      seededId(variantItemId),
      seededId(targetItemId),
      seededId(overlapItemId),
      seededId(zeroAvailItemId),
      seededId(dualRowItemId),
      seededId(openGapItemId),
      seededId(partialGapItemId),
    ];
    const allOrderIds = [
      seededId(orderId),
      seededId(priorOrderId),
      seededId(putusOrderId),
      seededId(openGapOrderId),
      seededId(partialGapOrderId),
    ];
    /* Rows a completed shipment writes — scoped to this spec's own orders, items and store. */
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: allOrderIds } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: allOrderIds } } });
    /* approveFieldSalesOrder (KONSI) reserves via StockReservation, and closeFieldSalesOrderRemainder only flips it RELEASED, never deletes it. */
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.storeAssortmentLine.deleteMany({ where: { id: { in: assortmentLineIds } } });
    await prisma.storeStock.deleteMany({ where: { id: { in: storeStockIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(putusStoreId)] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: allItemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("returns an empty list for a non-existent order", async () => {
    const rows = await listKonsiAssortmentGaps("does-not-exist");
    expect(rows).toEqual([]);
  });

  it("returns an empty list for a non-KONSI order", async () => {
    const rows = await listKonsiAssortmentGaps(putusOrderId);
    expect(rows).toEqual([]);
  });

  it("excludes a gap at VARIANT grain when that variant is already on the order, but keeps a different variant of the same item", async () => {
    const rows = await listKonsiAssortmentGaps(orderId);
    const variantRows = rows.filter((r) => r.itemId === variantItemId);
    expect(variantRows.map((r) => r.variantSku)).toEqual(["V2"]);
  });

  it("passes onHandQty and targetQty through unchanged", async () => {
    const rows = await listKonsiAssortmentGaps(orderId);
    const row = rows.find((r) => r.itemId === targetItemId)!;
    expect(row.onHandQty).toBe(1);
    expect(row.targetQty).toBe(5);
    expect(row.sku).toBe(`TEST-KAG-TGT-${token}`);
  });

  it("a previously-sent assortment item appears in the gap list and NOT in the never-sent list, and the two lists never intersect for this order", async () => {
    const gaps = await listKonsiAssortmentGaps(orderId);
    const neverSent = await listKonsiSuggestions(orderId);

    const gapKeys = new Set(gaps.map((r) => `${r.itemId}::${r.variantSku}`));
    const neverSentKeys = new Set(neverSent.map((r) => `${r.itemId}::${r.variantSku}`));

    expect(gapKeys.has(`${prevSentItemId}::`)).toBe(true);
    expect(neverSentKeys.has(`${prevSentItemId}::`)).toBe(false);
    expect(neverSent.map((r) => r.itemId)).not.toContain(prevSentItemId);

    for (const key of gapKeys) {
      expect(neverSentKeys.has(key)).toBe(false);
    }
  });

  it("an item that is both a never-sent candidate and an assortment gap is returned under the gap set only", async () => {
    const gaps = await listKonsiAssortmentGaps(orderId);
    const neverSent = await listKonsiSuggestions(orderId);

    const key = `${overlapItemId}::`;
    expect(gaps.some((r) => r.itemId === overlapItemId && r.variantSku === "")).toBe(true);
    expect(neverSent.some((r) => r.itemId === overlapItemId)).toBe(false);

    const neverSentKeys = new Set(neverSent.map((r) => `${r.itemId}::${r.variantSku}`));
    expect(neverSentKeys.has(key)).toBe(false);
  });

  it("drops a genuine gap with available === 0 from the stageable panel, but keeps it on the read-only store-card gap list", async () => {
    const stageable = await listKonsiAssortmentGaps(orderId);
    expect(stageable.some((r) => r.itemId === zeroAvailItemId)).toBe(false);

    const readOnly = await listAssortmentGaps(storeId);
    expect(readOnly.some((r) => r.itemId === zeroAvailItemId && r.variantSku === "")).toBe(true);
  });

  it("folds a dual null/\"\" InventoryValue row via Math.min, not sum", async () => {
    const rows = await listKonsiAssortmentGaps(orderId);
    const row = rows.find((r) => r.itemId === dualRowItemId);
    expect(row).toBeDefined();
    expect(row!.available).toBe(3);
    expect(row!.available).not.toBe(13);
  });

  it("openKonsiQtyByKey returns the full remaining qty for an approved konsi order and nothing for a still-pending one", async () => {
    const openMap = await openKonsiQtyByKey(prisma, storeId, [openGapItemId, variantItemId]);
    expect(openMap.get(`${openGapItemId}::`)).toBe(6);
    expect(openMap.get(`${variantItemId}::V1`)).toBeUndefined();
  });

  it("an approved-but-undelivered konsi line is netted (onHand + inTransit) and does not read as an assortment gap", async () => {
    const gaps = await listAssortmentGaps(storeId);
    expect(gaps.find((g) => g.itemId === openGapItemId)).toBeUndefined();
  });

  it("closing the order's remainder (never delivered) makes the gap reappear, with onHandQty staying physical (0) and inTransitQty dropping to 0", async () => {
    await closeFieldSalesOrderRemainder({ orderId: openGapOrderId, closedById: userId, reason: "test: never delivered" });
    const gaps = await listAssortmentGaps(storeId);
    const row = gaps.find((g) => g.itemId === openGapItemId);
    expect(row).toBeDefined();
    expect(row!.onHandQty).toBe(0);
    expect(row!.inTransitQty).toBe(0);
  });

  it("a gap whose target the in-transit qty alone doesn't meet reports onHandQty (physical) and inTransitQty separately, never pre-summed", async () => {
    const gaps = await listAssortmentGaps(storeId);
    const row = gaps.find((g) => g.itemId === partialGapItemId);
    expect(row).toBeDefined();
    expect(row!.onHandQty).toBe(0);
    expect(row!.inTransitQty).toBe(6);
    expect(row!.targetQty).toBe(10);
  });

  it("a delivered line counts through StoreStock instead: onHandQty reads the delivered qty and inTransitQty drops to 0", async () => {
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(partialGapOrderId) } });
    const { shipmentId } = await createDeliveryShipment({
      orderId: partialGapOrderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: line.id, qty: 6 }],
      packedById: userId,
    });
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `RESI-KAG-${token}` });
    await shipDeliveryShipment({ shipmentId, shippedById: userId });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
      lines: [{ shipmentLineId: shipment.lines[0].id, deliveredQty: 6 }],
    });

    /* Target 10, six delivered: still a gap, now carried by the physical figure alone. */
    const gaps = await listAssortmentGaps(storeId);
    const row = gaps.find((g) => g.itemId === partialGapItemId);
    expect(row).toBeDefined();
    expect(row!.onHandQty).toBe(6);
    expect(row!.inTransitQty).toBe(0);
    expect(row!.targetQty).toBe(10);
  });
});
