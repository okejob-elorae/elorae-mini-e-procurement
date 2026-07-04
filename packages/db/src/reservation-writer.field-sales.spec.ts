import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { reserveFieldSalesOrder, consumeFieldSalesOrder, releaseFieldSalesOrder } from "./reservation-writer";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("field-sales reservation fns (test bed only)", () => {
  let itemId: string;
  let uomId: string;
  const variantSku = "";
  const sku = `TEST-FS-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({
      data: { itemId, variantSku, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("reserve increments reservedQty and is idempotent per fieldSalesLineId", async () => {
    const lineId = `line-${sku}-1`;
    const r1 = await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-1", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    expect(r1.reserved).toBe(1);
    const r2 = await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-1", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    expect(r2.skipped).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.reservedQty)).toBe(6);
  });

  it("consume decrements qtyOnHand + reservedQty and stamps FIELD_SALES_CONSUME", async () => {
    const lineId = `line-${sku}-2`;
    await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-2", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    const res = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-2", fieldSalesLineIds: [lineId] });
    expect(res.consumed).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.qtyOnHand)).toBe(94);
    expect(Number(inv!.reservedQty)).toBe(0);
    const adj = await prisma.stockAdjustment.findFirst({ where: { itemId, source: "FIELD_SALES_CONSUME" } });
    expect(adj).not.toBeNull();
    expect(Number(adj!.qtyChange)).toBe(-6);
  });

  it("release frees reservedQty without touching qtyOnHand", async () => {
    const lineId = `line-${sku}-3`;
    await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-3", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    const res = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId] });
    expect(res.released).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.qtyOnHand)).toBe(100);
    expect(Number(inv!.reservedQty)).toBe(0);
  });
});
