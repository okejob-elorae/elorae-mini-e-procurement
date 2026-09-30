import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { consumeOrder, releaseOrder, reserveOrder } from "./reservation-writer";
import { seededId } from "./spec-teardown";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("consumeOrder (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  let salesOrderId = "";
  const variantSku = "";
  const sku = `TEST-CONSUME-${Math.random().toString(36).slice(2, 10)}`;
  // Random (not Date.now()/1000) so a re-run within the same second can't collide on SalesOrder_salesorderId_key.
  const salesorderId = Math.floor(Math.random() * 2_000_000_000);
  const salesorderDetailId = salesorderId + 1;

  const AVG_COST = 1000;
  const QTY = 3;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";
    salesOrderId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    await prisma.inventoryValue.create({
      data: {
        itemId,
        variantSku,
        qtyOnHand: 100,
        reservedQty: QTY,
        avgCost: AVG_COST,
        totalValue: 100000,
      },
    });

    const salesOrder = await prisma.salesOrder.create({
      data: {
        salesorderId,
        salesorderNo: "TEST-SO",
        channel: "OFFLINE",
        sourceName: "test",
        status: "NEW",
        subTotal: 3000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 3000,
        transactionDate: new Date(),
      },
    });
    salesOrderId = salesOrder.id;

    await prisma.salesOrderItem.create({
      data: {
        salesOrderId,
        salesorderDetailId,
        jubelioItemId: salesorderDetailId,
        jubelioItemCode: sku,
        itemId,
        productName: "test",
        qty: QTY,
        qtyInBase: QTY,
        unitPrice: 1000,
        pricePaid: 1000,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 3000,
      },
    });

    await prisma.stockReservation.create({
      data: {
        salesorderId,
        salesorderDetailId,
        itemId,
        variantSku,
        qty: QTY,
        state: "RESERVED",
      },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: seededId(salesOrderId) } });
    await prisma.salesOrder.deleteMany({ where: { id: seededId(salesOrderId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("stamps cogs = avgCost × qty on the SalesOrderItem when the line is consumed", async () => {
    const res = await consumeOrder(prisma, { salesorderId, salesorderNo: "TEST-SO" });
    expect(res.consumed).toBe(1);

    const line = await prisma.salesOrderItem.findUnique({ where: { salesorderDetailId } });
    expect(Number(line!.cogs)).toBe(AVG_COST * QTY);
  });
});

d("Jubelio reservation on variantless rows spelled null (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const sku = `TEST-JNULL-${Math.random().toString(36).slice(2, 10)}`;
  /* Random ids: a re-run within the same second must not collide on the unique detail id. */
  const salesorderId = Math.floor(Math.random() * 2_000_000_000);
  const detailA = salesorderId + 1;
  const detailB = salesorderId + 2;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("reserve, consume and release all resolve the only row, spelled variantSku: null", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
    });

    const r1 = await reserveOrder(prisma, {
      salesorderId,
      salesorderNo: "TEST-JNULL-1",
      lines: [{ salesorderDetailId: detailA, itemId, variantSku: "", qty: 6 }],
    });
    expect(r1.reserved).toBe(1);
    let inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(inv!.reservedQty)).toBe(6);
    expect(Number(inv!.qtyOnHand)).toBe(100);

    const consumeRes = await consumeOrder(prisma, { salesorderId, salesorderNo: "TEST-JNULL-1" });
    expect(consumeRes.consumed).toBe(1);
    inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(inv!.qtyOnHand)).toBe(94);
    expect(Number(inv!.reservedQty)).toBe(0);
    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].qty)).toBe(-6);

    const salesorderId2 = salesorderId + 10;
    await reserveOrder(prisma, {
      salesorderId: salesorderId2,
      salesorderNo: "TEST-JNULL-2",
      lines: [{ salesorderDetailId: detailB, itemId, variantSku: "", qty: 4 }],
    });
    inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(inv!.reservedQty)).toBe(4);

    const releaseRes = await releaseOrder(prisma, { salesorderId: salesorderId2 });
    expect(releaseRes.released).toBe(1);
    inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(inv!.qtyOnHand)).toBe(94);
    expect(Number(inv!.reservedQty)).toBe(0);
  });

  it("with both spellings present, reserve and consume land on the empty-string row and leave null untouched", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 1000, reservedQty: 12, avgCost: 1000, totalValue: 1000000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 999, reservedQty: 0, avgCost: 1000, totalValue: 999000 },
    });

    await reserveOrder(prisma, {
      salesorderId,
      salesorderNo: "TEST-JNULL-DUAL",
      lines: [{ salesorderDetailId: detailA, itemId, variantSku: "", qty: 6 }],
    });
    let empty = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: "" } });
    let nullRow = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(empty!.reservedQty)).toBe(6);
    expect(Number(nullRow!.reservedQty)).toBe(12);

    const consumeRes = await consumeOrder(prisma, { salesorderId, salesorderNo: "TEST-JNULL-DUAL" });
    expect(consumeRes.consumed).toBe(1);
    empty = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: "" } });
    nullRow = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: null } });
    expect(Number(empty!.qtyOnHand)).toBe(993);
    expect(Number(empty!.reservedQty)).toBe(0);
    expect(Number(nullRow!.qtyOnHand)).toBe(1000);
    expect(Number(nullRow!.reservedQty)).toBe(12);
  });
});
