import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { priceApprovedReturnLine } from "./valuation-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * An APPROVED retur left at valuationStatus PENDING: line A was priced at approval (2 x 1.000),
 * line B could not be (nothing was ever delivered to the store, so it is UNPRICEABLE and only a
 * manual price can value it). Built directly rather than through the approve writer, the same way
 * the pricing race spec builds its retur, so each case starts from exactly the state it pins.
 */
d("priceApprovedReturnLine (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let returnId = "";
  let lineAId = "";
  let lineBId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    userId = "";
    returnId = "";
    lineAId = "";
    lineBId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRVW-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-FRVW-${token}`,
        nameId: "Retur valuation item",
        nameEn: "Retur valuation item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: {
        code: `TEST-FRVW-STORE-${token}`,
        name: "Test Valuation Store",
        address: "Test address",
        termsType: "PUTUS",
        isActive: true,
      },
    });
    storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-frvw-${token}@example.com`, name: "Test Valuation User" } });
    userId = user.id;

    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-FRVW-RET-${token}`,
        storeId,
        raisedById: userId,
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: userId,
        valuationStatus: "PENDING",
        totalValue: null,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
      },
    });
    returnId = ret.id;

    const lineA = await prisma.fieldReturnLine.create({
      data: {
        returnId,
        itemId,
        variantSku: "M",
        qty: 2,
        reason: "UNSOLD",
        receivedQty: 2,
        sellableQty: 2,
        rejectedQty: 0,
        creditedQty: 2,
        priceSource: "MANUAL",
        unitPrice: 1000,
        lineValue: 2000,
        priceNote: "priced before approval",
      },
    });
    lineAId = lineA.id;

    const lineB = await prisma.fieldReturnLine.create({
      data: {
        returnId,
        itemId,
        variantSku: "L",
        qty: 3,
        reason: "UNSOLD",
        receivedQty: 3,
        sellableQty: 3,
        rejectedQty: 0,
        creditedQty: 3,
      },
    });
    lineBId = lineB.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(returnId) } });
    await prisma.fieldReturnResolution.deleteMany({ where: { lineId: { in: [seededId(lineAId), seededId(lineBId)] } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function auditCount(): Promise<number> {
    return prisma.auditLog.count({
      where: { entityId: seededId(returnId), action: "FIELD_RETURN_LINE_PRICED_AFTER_APPROVAL" },
    });
  }

  it("values the last unpriced line, totals the header and flips it VALUED with one audit row", async () => {
    const res = await priceApprovedReturnLine({
      lineId: lineBId,
      manualUnitPrice: 500,
      note: "  harga nota toko  ",
      userId,
    });
    expect(res).toEqual({ ok: true, valued: true });

    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue?.toNumber()).toBe(1500);
    expect(b.unitPrice?.toNumber()).toBe(500);
    expect(b.priceSource).toBe("MANUAL");
    expect(b.priceDeliveryLineId).toBeNull();
    expect(b.priceNote).toBe("harga nota toko");

    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(ret.totalValue?.toNumber()).toBe(3500);
    expect(ret.valuationStatus).toBe("VALUED");
    expect(ret.status).toBe("APPROVED");

    expect(await auditCount()).toBe(1);
  });

  it("refuses ALREADY_APPROVED once the retur is VALUED and changes nothing", async () => {
    const first = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 500, note: "first", userId });
    expect(first).toEqual({ ok: true, valued: true });

    const second = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 900, note: "second", userId });
    expect(second).toEqual({ ok: false, code: "ALREADY_APPROVED" });

    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue?.toNumber()).toBe(1500);
    expect(b.priceNote).toBe("first");
    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(ret.totalValue?.toNumber()).toBe(3500);
    expect(await auditCount()).toBe(1);
  });

  it("refuses repricing a line that already holds a value on a PENDING retur, while an unpriced sibling stays priceable", async () => {
    const refused = await priceApprovedReturnLine({ lineId: lineAId, manualUnitPrice: 9000, note: "reprice", userId });
    expect(refused).toEqual({ ok: false, code: "ALREADY_APPROVED" });

    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.lineValue?.toNumber()).toBe(2000);
    expect(a.unitPrice?.toNumber()).toBe(1000);
    expect(a.priceNote).toBe("priced before approval");
    const before = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(before.valuationStatus).toBe("PENDING");
    expect(before.totalValue).toBeNull();
    expect(await auditCount()).toBe(0);

    const priced = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 500, note: "still priceable", userId });
    expect(priced).toEqual({ ok: true, valued: true });

    const after = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(after.valuationStatus).toBe("VALUED");
    expect(after.totalValue?.toNumber()).toBe(3500);
    expect(await auditCount()).toBe(1);
  });

  it("prices one of two unpriced lines and leaves the header PENDING with a null total, never a partial sum", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: seededId(lineAId) },
      data: { priceSource: null, unitPrice: null, lineValue: null, priceNote: null },
    });

    const res = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 500, note: "one of two", userId });
    expect(res).toEqual({ ok: true, valued: false });

    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue?.toNumber()).toBe(1500);
    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(ret.valuationStatus).toBe("PENDING");
    expect(ret.totalValue).toBeNull();
    expect(await auditCount()).toBe(1);
  });

  it("refuses a retur that is not APPROVED with INVALID_STATE", async () => {
    await prisma.fieldReturn.update({ where: { id: seededId(returnId) }, data: { status: "PENDING_APPROVAL" } });

    const res = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 500, note: "too early", userId });
    expect(res).toEqual({ ok: false, code: "INVALID_STATE" });

    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it("refuses a delivery line that is not one of this line's candidates with PRICE_NOT_AVAILABLE", async () => {
    const res = await priceApprovedReturnLine({ lineId: lineBId, deliveryLineId: "no-such-delivery-line", userId });
    expect(res).toEqual({ ok: false, code: "PRICE_NOT_AVAILABLE" });

    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue).toBeNull();
    expect(b.priceSource).toBeNull();
    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(ret.valuationStatus).toBe("PENDING");
    expect(await auditCount()).toBe(0);
  });

  it("re-amounts a SALESMAN_BEARS latest resolution on the missing units at the new price", async () => {
    /* Claimed 5, received 3, the shortfall borne by the salesman — so the store is credited the
       full claimed 5, and the salesman owes the 2 missing units. */
    await prisma.fieldReturnLine.update({
      where: { id: seededId(lineBId) },
      data: { qty: 5, receivedQty: 3, sellableQty: 3, creditedQty: 5 },
    });
    const resolution = await prisma.fieldReturnResolution.create({
      data: { lineId: lineBId, type: "SALESMAN_BEARS", qty: 2, createdById: userId },
    });

    const res = await priceApprovedReturnLine({ lineId: lineBId, manualUnitPrice: 500, note: "borne", userId });
    expect(res).toEqual({ ok: true, valued: true });

    const updated = await prisma.fieldReturnResolution.findUniqueOrThrow({ where: { id: seededId(resolution.id) } });
    expect(updated.amount?.toNumber()).toBe(1000);
    const b = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineBId) } });
    expect(b.lineValue?.toNumber()).toBe(2500);
    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(ret.totalValue?.toNumber()).toBe(4500);
  });
});
