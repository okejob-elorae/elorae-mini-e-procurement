import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "../writer";
import { InsufficientStockError } from "../errors";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the create-time fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

d("issueKonsiTransfer via approveFieldSalesOrder (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let variantlessItemId = "";
  let shortItemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

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
  });

  afterEach(async () => {
    const itemIds = [seededId(itemId), seededId(variantlessItemId), seededId(shortItemId)];
    const orderIds = [seededId(orderId), seededId(secondOrderId), seededId(variantlessOrderId), seededId(shortOrderId)];

    await prisma.konsiTransferLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
  });

  it("nets qtyOnHand down and reservedQty back to its pre-order level across reserve-then-consume in one transaction", async () => {
    /*
     * reserveKonsiFieldSalesOrder bumps reservedQty by +6 and issueKonsiTransfer immediately
     * consumes it back by -6, both inside the same approve() transaction — so the net change
     * visible from outside is qtyOnHand -6, reservedQty +0. A broken implementation that
     * decremented qtyOnHand but forgot to release the just-created reservation would instead
     * leave reservedQty elevated by +6 forever, which is exactly what this pins.
     */
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) - 6);
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty));
  });

  it("upserts StoreStock at the blended cost", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(6);
    expect(Number(ss.avgCost)).toBe(10_000);
  });

  it("blends rather than overwrites on a second transfer into a non-empty store", async () => {
    /* first transfer 6 @ 10.000, then a second order of 6 against inventory re-stocked at 20.000 */
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.update({ where: { id: inv.id }, data: { avgCost: 20_000 } });
    await approveFieldSalesOrder({ orderId: secondOrderId, approvedById: salesmanId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(12);
    expect(Number(ss.avgCost)).toBe(15_000);
  });

  it("flips the line's reservation to CONSUMED", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const res = await prisma.stockReservation.findFirstOrThrow({ where: { fieldSalesLineId: seededId(lineId) } });
    expect(res.state).toBe("CONSUMED");
    expect(Number(res.consumedQty)).toBe(6);
    expect(res.resolvedAt).not.toBeNull();
  });

  it("writes a NEGATIVE StockAdjustment sourced KONSI_TRANSFER", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "KONSI_TRANSFER" } });
    expect(adj.type).toBe("NEGATIVE");
    expect(Number(adj.qtyChange)).toBe(-6);
  });

  it("creates the transfer document with a KTRF number and orderLineId provenance", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    const t = await prisma.konsiTransfer.findFirstOrThrow({ where: { orderId: seededId(orderId) }, include: { lines: true } });
    expect(t.docNo.startsWith("KTRF/")).toBe(true);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].orderLineId).toBe(lineId);
  });

  it('writes "" into StoreStock for a variantless line while reading the null InventoryValue row', async () => {
    /* the fixture's inventory row is seeded with variantSku: null */
    await approveFieldSalesOrder({ orderId: variantlessOrderId, approvedById: salesmanId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(variantlessItemId) } });
    expect(ss.variantSku).toBe("");
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(variantlessItemId) } });
    expect(inv.variantSku).toBeNull();
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(variantlessItemId) } })).toBe(1);
  });

  it("moves nothing when a line is short — the existing reserve guard still aborts", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    await expect(approveFieldSalesOrder({ orderId: shortOrderId, approvedById: salesmanId })).rejects.toBeInstanceOf(InsufficientStockError);
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(shortOrderId) } })).toBe(0);
  });

  it("creates no second transfer when an already-APPROVED order is re-approved", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(1);
  });
});
