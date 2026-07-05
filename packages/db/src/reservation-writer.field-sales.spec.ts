import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import {
  reserveFieldSalesOrder,
  consumeFieldSalesOrder,
  releaseFieldSalesOrder,
  reserveKonsiFieldSalesOrder,
} from "./reservation-writer";

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

  describe("variantless InventoryValue row keyed with variantSku: null (real-world convention)", () => {
    let nullItemId: string;
    let nullUomId: string;
    const nullSku = `TEST-FS-NULL-${Math.random().toString(36).slice(2, 10)}`;

    beforeEach(async () => {
      const uom = await prisma.uOM.create({
        data: { code: `TEST-UOM-${nullSku}`, nameId: "test", nameEn: "test" },
      });
      nullUomId = uom.id;
      const item = await prisma.item.create({
        data: { sku: nullSku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId: nullUomId },
      });
      nullItemId = item.id;
      await prisma.inventoryValue.create({
        data: { itemId: nullItemId, variantSku: null, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
      });
    });

    afterEach(async () => {
      await prisma.stockReservation.deleteMany({ where: { itemId: nullItemId } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: nullItemId } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: nullItemId } });
      await prisma.item.deleteMany({ where: { id: nullItemId } });
      await prisma.uOM.deleteMany({ where: { id: nullUomId } });
    });

    it("reserve, consume, and release all succeed against a variantSku: null row", async () => {
      const lineId = `line-${nullSku}-1`;

      const r1 = await reserveFieldSalesOrder(prisma, {
        orderNo: "PUTUS-T-NULL-1",
        lines: [{ fieldSalesLineId: lineId, itemId: nullItemId, variantSku: "", qty: 6 }],
      });
      expect(r1.reserved).toBe(1);
      let inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.reservedQty)).toBe(6);
      expect(Number(inv!.qtyOnHand)).toBe(100);

      const consumeRes = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-NULL-1", fieldSalesLineIds: [lineId] });
      expect(consumeRes.consumed).toBe(1);
      inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.qtyOnHand)).toBe(94);
      expect(Number(inv!.reservedQty)).toBe(0);
      const adj = await prisma.stockAdjustment.findFirst({ where: { itemId: nullItemId, source: "FIELD_SALES_CONSUME" } });
      expect(adj).not.toBeNull();
      expect(Number(adj!.qtyChange)).toBe(-6);

      const lineId2 = `line-${nullSku}-2`;
      await reserveFieldSalesOrder(prisma, {
        orderNo: "PUTUS-T-NULL-2",
        lines: [{ fieldSalesLineId: lineId2, itemId: nullItemId, variantSku: "", qty: 4 }],
      });
      const releaseRes = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId2] });
      expect(releaseRes.released).toBe(1);
      inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.qtyOnHand)).toBe(94);
      expect(Number(inv!.reservedQty)).toBe(0);
    });
  });
});

d("reserveKonsiFieldSalesOrder (test bed only)", () => {
  let itemId: string;
  let uomId: string;
  const variantSku = "";
  const sku = `TEST-KONSI-${Math.random().toString(36).slice(2, 10)}`;

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

  it("reserves qty item-level with source FIELD_SALES_KONSI and increments reservedQty", async () => {
    const lineId = `konsi-line-${sku}-1`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI/2026/0001",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 3 }],
    });
    expect(res.reserved).toBe(1);
    expect(res.shortLines).toEqual([]);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(3);
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: lineId } });
    expect(rsv!.source).toBe("FIELD_SALES_KONSI");
    expect(rsv!.state).toBe("RESERVED");
  });

  it("reports shortLines and does NOT reserve when qty exceeds available", async () => {
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId, variantSku } },
      data: { qtyOnHand: 2 },
    });
    const lineId = `konsi-line-${sku}-2`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI/2026/0002",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 5 }],
    });
    expect(res.reserved).toBe(0);
    expect(res.shortLines).toHaveLength(1);
    expect(res.shortLines[0].itemId).toBe(itemId);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(0);
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: lineId } });
    expect(rsv).toBeNull();
  });

  it("is idempotent — re-reserving the same line skips", async () => {
    const lineId = `konsi-line-${sku}-3`;
    const input = { orderNo: "KONSI/2026/0003", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 3 }] };
    await reserveKonsiFieldSalesOrder(prisma, input);
    const res2 = await reserveKonsiFieldSalesOrder(prisma, input);
    expect(res2.reserved).toBe(0);
    expect(res2.skipped).toBe(1);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(3);
  });
});
