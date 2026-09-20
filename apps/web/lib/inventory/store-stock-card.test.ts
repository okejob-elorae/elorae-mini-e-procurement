import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getStoreStockCard } from "./store-stock-card";

/* Read-only, but the fixtures write real rows — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getStoreStockCard", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let userId = "";
  let storeId = "";
  let otherStoreId = "";
  let itemAId = "";
  let itemBId = "";
  let visitId = "";
  let orderId = "";
  let transferId = "";
  let transferEntryId = "";
  let returnEntryId = "";
  let spgSaleEntryId = "";
  let mainEntryId = "";
  let otherStoreEntryId = "";
  let zeroQtyEntryId = "";

  const T0 = new Date("2026-01-14T00:00:00.000Z");
  const T1 = new Date("2026-01-15T00:00:00.000Z");
  const T2 = new Date("2026-01-16T00:00:00.000Z");
  const T3 = new Date("2026-01-17T00:00:00.000Z");

  beforeEach(async () => {
    uomId = "";
    userId = "";
    storeId = "";
    otherStoreId = "";
    itemAId = "";
    itemBId = "";
    visitId = "";
    orderId = "";
    transferId = "";
    transferEntryId = "";
    returnEntryId = "";
    spgSaleEntryId = "";
    mainEntryId = "";
    otherStoreEntryId = "";
    zeroQtyEntryId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SSC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `test-ssc-${token}@example.com`, name: "Test Salesman" } });
    userId = user.id;

    const store = await prisma.store.create({
      data: { code: `TEST-SSC-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    /* Minted then deleted right away, to get a genuine cuid for the "wrong store" scoping
       assertion below — same idiom stock-ledger-card.query.test.ts uses for its "deleted
       store" case, reused here purely for a real, distinct id. */
    const other = await prisma.store.create({
      data: { code: `TEST-SSC-OTHER-${token}`, name: "Other Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    otherStoreId = other.id;
    await prisma.store.delete({ where: { id: otherStoreId } });

    /* itemA sits in main + van too — exercises the getStockAcrossLocations join. */
    const itemA = await prisma.item.create({
      data: { sku: `TEST-SSC-A-${token}`, nameId: "Item A", nameEn: "Item A", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemAId = itemA.id;
    await prisma.inventoryValue.create({ data: { itemId: itemAId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    await prisma.vanStock.create({ data: { userId, itemId: itemAId, variantSku: "", qty: 4, avgCost: 1000 } });
    await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 6, avgCost: 1000 } });

    /* itemB has NO main/van presence and a NEGATIVE StoreStock row — must sort first. */
    const itemB = await prisma.item.create({
      data: { sku: `TEST-SSC-B-${token}`, nameId: "Item B", nameEn: "Item B", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemBId = itemB.id;
    await prisma.storeStock.create({ data: { storeId, itemId: itemBId, variantSku: "", qty: -3, avgCost: 0 } });

    const visit = await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-SSC/${token}`,
        storeId,
        salesmanId: userId,
        visitId,
        status: "APPROVED",
        orderType: "KONSI",
        subtotal: 0,
        total: 0,
      },
    });
    orderId = order.id;

    /* No KonsiTransferLine any more — the card reads the ledger, not this document's lines.
       The transfer document itself still has to exist: a KonsiTransfer movement has no detail
       page of its own and links to this order through a batched lookup on refId. */
    const transfer = await prisma.konsiTransfer.create({
      data: {
        docNo: `KONSITRF/TEST-SSC/${token}`,
        orderId,
        storeId,
        transferredById: userId,
        createdAt: T1,
      },
    });
    transferId = transfer.id;

    const transferEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId: itemAId,
        variantSku: "",
        type: "IN",
        qty: 6,
        balanceQty: 6,
        refType: "KonsiTransfer",
        refId: transferId,
        refDocNumber: transfer.docNo,
        createdAt: T1,
      },
    });
    transferEntryId = transferEntry.id;

    /* A retur-driven decrement. No real FieldReturn document is needed — the card's href
       builder for "FieldReturn" is a plain template over refId, never a join. */
    const returnEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId: itemAId,
        variantSku: "",
        type: "OUT",
        qty: -2,
        balanceQty: 4,
        refType: "FieldReturn",
        refId: `TEST-SSC-RET-${token}`,
        refDocNumber: `TEST-SSC-RET-${token}`,
        createdAt: T2,
      },
    });
    returnEntryId = returnEntry.id;

    /* An SPG sale decrement — a movement kind the old KonsiTransferLine + FieldReturnLine list
       could never show, since it read neither of those two tables. This is the case the whole
       task exists to prove. */
    const spgSaleEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId: itemBId,
        variantSku: "",
        type: "OUT",
        qty: -1,
        balanceQty: -4,
        refType: "SpgSale",
        refId: `TEST-SSC-SPG-${token}`,
        refDocNumber: `SPGSALE/TEST-SSC/${token}`,
        createdAt: T3,
      },
    });
    spgSaleEntryId = spgSaleEntry.id;

    /* Same item, MAIN location — proves the query scopes on locationType, not just itemId. */
    const mainEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId: itemAId,
        variantSku: "",
        type: "IN",
        qty: 50,
        balanceQty: 50,
        refType: "GRN",
        refId: `TEST-SSC-GRN-${token}`,
        refDocNumber: `GRN/TEST-SSC/${token}`,
        createdAt: T1,
      },
    });
    mainEntryId = mainEntry.id;

    /* Same locationType, a DIFFERENT store id — proves the query scopes on locationId, not
       just locationType. */
    const otherStoreEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: otherStoreId,
        itemId: itemAId,
        variantSku: "",
        type: "IN",
        qty: 9,
        balanceQty: 9,
        refType: "KonsiTransfer",
        refId: `TEST-SSC-OTHER-KTF-${token}`,
        refDocNumber: `KONSITRF-OTHER/TEST-SSC/${token}`,
        createdAt: T1,
      },
    });
    otherStoreEntryId = otherStoreEntry.id;

    /*
     * Deliberate change from the old document-joined behaviour: moveStoreStock (the DELTA
     * mover) has no zero-delta short-circuit — unlike its sibling setStoreStock, which does —
     * so a konsi retur approved crediting zero (the "lost sack" case, where an all-zero
     * receive count is explicitly valid) still writes a qty: 0 STORE ledger row. The card does
     * not filter it out: the ledger is the record of what happened, and a processed retur that
     * credited nothing back is a real event an operator should see, not a row to hide.
     */
    const zeroQtyEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId: itemAId,
        variantSku: "",
        type: "OUT",
        qty: 0,
        balanceQty: 6,
        refType: "FieldReturn",
        refId: `TEST-SSC-RET-ZERO-${token}`,
        refDocNumber: `TEST-SSC-RET-ZERO-${token}`,
        createdAt: T0,
      },
    });
    zeroQtyEntryId = zeroQtyEntry.id;
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        id: {
          in: [
            seededId(transferEntryId),
            seededId(returnEntryId),
            seededId(spgSaleEntryId),
            seededId(mainEntryId),
            seededId(otherStoreEntryId),
            seededId(zeroQtyEntryId),
          ],
        },
      },
    });
    await prisma.konsiTransfer.deleteMany({ where: { id: seededId(transferId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.storeStock.deleteMany({ where: { itemId: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.vanStock.deleteMany({ where: { itemId: seededId(itemAId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemAId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("sorts the negative StoreStock row first and reports the right negativeCount", async () => {
    const card = await getStoreStockCard(storeId);
    expect(card.rows).toHaveLength(2);
    expect(card.rows[0].itemId).toBe(itemBId);
    expect(card.rows[0].qty).toBe(-3);
    expect(card.rows[1].itemId).toBe(itemAId);
    expect(card.rows[1].qty).toBe(6);
    expect(card.negativeCount).toBe(1);
  });

  it("joins getStockAcrossLocations onto the right row via itemId::variantSku, not the other item", async () => {
    const card = await getStoreStockCard(storeId);
    const rowA = card.rows.find((r) => r.itemId === itemAId)!;
    const rowB = card.rows.find((r) => r.itemId === itemBId)!;
    expect(rowA.mainQty).toBe(10);
    expect(rowA.vanQty).toBe(4);
    expect(rowB.mainQty).toBe(0);
    expect(rowB.vanQty).toBe(0);
  });

  it("scopes movements to this store's own STORE-located ledger rows, excluding MAIN and another store", async () => {
    const card = await getStoreStockCard(storeId);
    const docNos = card.movements.map((m) => m.docNo);
    expect(docNos).not.toContain(`GRN/TEST-SSC/${token}`);
    expect(docNos).not.toContain(`KONSITRF-OTHER/TEST-SSC/${token}`);
    expect(card.movements).toHaveLength(4);
  });

  it("includes the konsi transfer, resolving its href through the order it was issued for", async () => {
    const card = await getStoreStockCard(storeId);
    const m = card.movements.find((mv) => mv.docNo === `KONSITRF/TEST-SSC/${token}`);
    expect(m).toBeDefined();
    expect(m!.refType).toBe("KonsiTransfer");
    expect(m!.qty).toBe(6);
    expect(m!.href).toBe(`/backoffice/field-sales-orders/${orderId}`);
  });

  it("includes the field return decrement, linking straight to its own detail page", async () => {
    const card = await getStoreStockCard(storeId);
    const m = card.movements.find((mv) => mv.docNo === `TEST-SSC-RET-${token}`);
    expect(m).toBeDefined();
    expect(m!.refType).toBe("FieldReturn");
    expect(m!.qty).toBe(-2);
    expect(m!.href).toBe(`/backoffice/field-returns/TEST-SSC-RET-${token}`);
  });

  /*
   * The point of this task: the old list joined KonsiTransferLine and FieldReturnLine only, so
   * an SPG sale could never appear no matter how the query was tuned. Reading the ledger
   * instead makes it show up for free.
   */
  it("includes an SPG sale — a movement kind the old KonsiTransferLine/FieldReturnLine list could never show", async () => {
    const card = await getStoreStockCard(storeId);
    const m = card.movements.find((mv) => mv.docNo === `SPGSALE/TEST-SSC/${token}`);
    expect(m).toBeDefined();
    expect(m!.refType).toBe("SpgSale");
    expect(m!.qty).toBe(-1);
    expect(m!.href).toBe(`/backoffice/spg-sales/TEST-SSC-SPG-${token}`);
  });

  it("orders movements newest first", async () => {
    const card = await getStoreStockCard(storeId);
    expect(card.movements.map((m) => m.docNo)).toEqual([
      `SPGSALE/TEST-SSC/${token}`,
      `TEST-SSC-RET-${token}`,
      `KONSITRF/TEST-SSC/${token}`,
      `TEST-SSC-RET-ZERO-${token}`,
    ]);
  });

  it("shows a zero-quantity movement rather than filtering it out", async () => {
    const card = await getStoreStockCard(storeId);
    const m = card.movements.find((mv) => mv.docNo === `TEST-SSC-RET-ZERO-${token}`);
    expect(m).toBeDefined();
    expect(m!.qty).toBe(0);
    expect(m!.refType).toBe("FieldReturn");
  });
});
