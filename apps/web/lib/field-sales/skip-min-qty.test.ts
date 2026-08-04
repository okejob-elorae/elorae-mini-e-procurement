import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { createFieldSalesOrder } from "./writer";
import { MinQtyViolationError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("createFieldSalesOrder — skipMinQty (test bed only)", () => {
  const sku = `TEST-FSSMQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  const subMinLine = () => ({ itemId, variantSku: "", productName: "X", qty: 1, unitPrice: 0 });

  it("throws MinQtyViolationError for a sub-min line by default", async () => {
    await expect(createFieldSalesOrder({ storeId, salesmanId, visitId, lines: [subMinLine()] })).rejects.toThrow(MinQtyViolationError);
  });

  it("allows a sub-min line when skipMinQty is true", async () => {
    const r = await createFieldSalesOrder({ storeId, salesmanId, visitId, skipMinQty: true, lines: [subMinLine()] });
    expect(r.orderNo).toMatch(/^PUTUS\//);
  });
});
