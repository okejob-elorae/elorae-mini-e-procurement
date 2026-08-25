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
  let itemAId = "";
  let itemBId = "";
  let orderId = "";
  let visitId = "";
  let transferId = "";
  let returnCreditedId = "";
  let returnZeroId = "";
  let returnPreCutoffId = "";

  const FIRST_TRANSFER_AT = new Date("2026-01-15T00:00:00.000Z");
  const AFTER_CUTOFF_APPROVED_AT = new Date("2026-02-01T00:00:00.000Z");
  const BEFORE_CUTOFF_APPROVED_AT = new Date("2025-12-01T00:00:00.000Z");

  beforeEach(async () => {
    uomId = "";
    userId = "";
    storeId = "";
    itemAId = "";
    itemBId = "";
    orderId = "";
    visitId = "";
    transferId = "";
    returnCreditedId = "";
    returnZeroId = "";
    returnPreCutoffId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SSC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `test-ssc-${token}@example.com`, name: "Test Salesman" } });
    userId = user.id;

    const store = await prisma.store.create({
      data: { code: `TEST-SSC-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

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

    const transfer = await prisma.konsiTransfer.create({
      data: {
        docNo: `KONSITRF/TEST-SSC/${token}`,
        orderId,
        storeId,
        transferredById: userId,
        createdAt: FIRST_TRANSFER_AT,
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Item A", qty: 6, unitCost: 1000 }] },
      },
    });
    transferId = transfer.id;

    /* Approved AFTER the store's first transfer — the only movement expected to render. */
    const returnCredited = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-SSC-RET-CR-${token}`,
        storeId,
        raisedById: userId,
        status: "APPROVED",
        approvedAt: AFTER_CUTOFF_APPROVED_AT,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: { create: [{ itemId: itemAId, variantSku: "", qty: 2, reason: "UNSOLD", creditedQty: 2 }] },
      },
    });
    returnCreditedId = returnCredited.id;

    /* Approved after the cutoff too, but creditedQty 0 — nothing was actually credited back. */
    const returnZero = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-SSC-RET-ZERO-${token}`,
        storeId,
        raisedById: userId,
        status: "APPROVED",
        approvedAt: AFTER_CUTOFF_APPROVED_AT,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: { create: [{ itemId: itemBId, variantSku: "", qty: 3, reason: "UNSOLD", creditedQty: 0 }] },
      },
    });
    returnZeroId = returnZero.id;

    /* Approved BEFORE the store's first transfer ever happened — its StoreStock decrement, if
       any, could not have touched a ledger that did not yet exist. Must not render. */
    const returnPreCutoff = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-SSC-RET-PRE-${token}`,
        storeId,
        raisedById: userId,
        status: "APPROVED",
        approvedAt: BEFORE_CUTOFF_APPROVED_AT,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: { create: [{ itemId: itemAId, variantSku: "", qty: 5, reason: "UNSOLD", creditedQty: 5 }] },
      },
    });
    returnPreCutoffId = returnPreCutoff.id;
  });

  afterEach(async () => {
    for (const returnId of [returnCreditedId, returnZeroId, returnPreCutoffId]) {
      await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    }
    await prisma.fieldReturn.deleteMany({
      where: { id: { in: [seededId(returnCreditedId), seededId(returnZeroId), seededId(returnPreCutoffId)] } },
    });
    await prisma.konsiTransferLine.deleteMany({ where: { transferId: seededId(transferId) } });
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

  it("produces no movement row for a retur line with creditedQty 0", async () => {
    const card = await getStoreStockCard(storeId);
    expect(card.movements.some((m) => m.id === `fret-${returnZeroId}` || m.docNo === `TEST-SSC-RET-ZERO-${token}`)).toBe(false);
  });

  it("includes the transfer and a post-cutoff retur, but excludes a retur approved before the store's first transfer", async () => {
    const card = await getStoreStockCard(storeId);
    const docNos = card.movements.map((m) => m.docNo);
    expect(docNos).toContain(`KONSITRF/TEST-SSC/${token}`);
    expect(docNos).toContain(`TEST-SSC-RET-CR-${token}`);
    expect(docNos).not.toContain(`TEST-SSC-RET-PRE-${token}`);

    const transferMovement = card.movements.find((m) => m.docNo === `KONSITRF/TEST-SSC/${token}`)!;
    expect(transferMovement.kind).toBe("TRANSFER_IN");
    expect(transferMovement.qty).toBe(6);

    const returMovement = card.movements.find((m) => m.docNo === `TEST-SSC-RET-CR-${token}`)!;
    expect(returMovement.kind).toBe("RETUR_OUT");
    expect(returMovement.qty).toBe(2);
  });
});
