import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { getSmartRequestHistory } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getSmartRequestHistory (test bed only)", () => {
  const sku = `TEST-FSQ-SRH-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let itemCId = "";
  let itemDId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const itemA = await prisma.item.create({ data: { sku: `${sku}-A`, nameId: "A", nameEn: "A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 10000 } });
    itemAId = itemA.id;
    const itemB = await prisma.item.create({ data: { sku: `${sku}-B`, nameId: "B", nameEn: "B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 10000 } });
    itemBId = itemB.id;
    const itemC = await prisma.item.create({ data: { sku: `${sku}-C`, nameId: "C", nameEn: "C", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 10000 } });
    itemCId = itemC.id;
    const itemD = await prisma.item.create({ data: { sku: `${sku}-D`, nameId: "D", nameEn: "D", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 10000 } });
    itemDId = itemD.id;

    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    // APPROVED putus with item A qty 10
    await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId, salesmanId, visitId, status: "APPROVED", orderType: "PUTUS", subtotal: 0, total: 0,
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "A", qty: 10, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    // PENDING_APPROVAL putus with item B qty 4
    await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId, salesmanId, visitId, status: "PENDING_APPROVAL", orderType: "PUTUS", subtotal: 0, total: 0,
        lines: { create: [{ itemId: itemBId, variantSku: "", productName: "B", qty: 4, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    // REJECTED putus with item C qty 7
    await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId, salesmanId, visitId, status: "REJECTED", orderType: "PUTUS", subtotal: 0, total: 0,
        lines: { create: [{ itemId: itemCId, variantSku: "", productName: "C", qty: 7, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    // item D never appears on any order
  });

  afterEach(async () => {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId: { in: [itemAId, itemBId, itemCId, itemDId] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.item.deleteMany({ where: { id: { in: [itemAId, itemBId, itemCId, itemDId] } } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("neverOrdered = candidates minus any non-rejected order's items", async () => {
    const h = await getSmartRequestHistory(storeId, [itemAId, itemBId, itemCId, itemDId]);
    // A (approved) and B (pending) are ordered; C only on a REJECTED order -> still "never ordered"; D never seen
    expect(h.neverOrdered).toEqual(new Set([itemCId, itemDId]));
  });

  it("qtyByItem sums APPROVED qty only", async () => {
    const h = await getSmartRequestHistory(storeId, [itemAId, itemBId, itemCId, itemDId]);
    expect(h.qtyByItem.get(itemAId)).toBe(10);
    expect(h.qtyByItem.has(itemBId)).toBe(false); // pending, not approved
    expect(h.qtyByItem.has(itemCId)).toBe(false); // rejected, not approved
    expect(h.qtyByItem.has(itemDId)).toBe(false); // never ordered
  });
});
