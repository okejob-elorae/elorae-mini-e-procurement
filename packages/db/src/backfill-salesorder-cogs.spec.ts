import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { resolveBackfillCogs } from "../prisma/backfill-salesorder-cogs";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("resolveBackfillCogs (test bed only)", () => {
  let itemId: string;
  let uomId: string;
  let salesOrderId: string;
  const sku = `TEST-BACKFILL-COGS-${Math.random().toString(36).slice(2, 10)}`;
  // Random (not Date.now()/1000) so parallel specs can't collide on SalesOrder_salesorderId_key.
  const salesorderId = Math.floor(Math.random() * 2_000_000_000);
  const salesorderDetailId1 = salesorderId + 1;
  const salesorderDetailId2 = salesorderId + 2;

  const AVG_COST = 1000;
  const QTY = 3;

  beforeEach(async () => {
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    const salesOrder = await prisma.salesOrder.create({
      data: {
        salesorderId,
        salesorderNo: "TEST-SO-BACKFILL",
        channel: "OFFLINE",
        sourceName: "test",
        status: "SHIPPED",
        subTotal: 6000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 6000,
        transactionDate: new Date(),
      },
    });
    salesOrderId = salesOrder.id;

    // Line 1 — already consumed: has a matching FULFILLMENT_CONSUME adjustment.
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId,
        salesorderDetailId: salesorderDetailId1,
        jubelioItemId: salesorderDetailId1,
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

    await prisma.stockAdjustment.create({
      data: {
        docNumber: `TEST-CONSUME-${salesorderDetailId1}`,
        itemId,
        type: "NEGATIVE",
        qtyChange: -QTY,
        reason: "test consume",
        prevQty: 100,
        newQty: 97,
        prevAvgCost: AVG_COST,
        newAvgCost: AVG_COST,
        source: "FULFILLMENT_CONSUME",
        idempotencyKey: `salesorder-999-consume-line-${salesorderDetailId1}`,
        externalRef: `salesorder:999`,
      },
    });

    // Line 2 — never consumed: no matching adjustment, should stay null.
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId,
        salesorderDetailId: salesorderDetailId2,
        jubelioItemId: salesorderDetailId2,
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
  });

  afterEach(async () => {
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId } });
    await prisma.salesOrder.deleteMany({ where: { id: salesOrderId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("backfills cogs from the consume adjustment; leaves unconsumed lines null", async () => {
    const res = await resolveBackfillCogs(prisma, { apply: true });

    const l1 = await prisma.salesOrderItem.findUnique({ where: { salesorderDetailId: salesorderDetailId1 } });
    const l2 = await prisma.salesOrderItem.findUnique({ where: { salesorderDetailId: salesorderDetailId2 } });

    expect(Number(l1!.cogs)).toBe(3000); // 1000 x |-3|
    expect(l2!.cogs).toBeNull();
    expect(res.updated).toBe(1);
  });

  it("dry-run reports the would-update count without writing", async () => {
    const res = await resolveBackfillCogs(prisma, { apply: false });

    const l1 = await prisma.salesOrderItem.findUnique({ where: { salesorderDetailId: salesorderDetailId1 } });

    expect(res.updated).toBe(1);   // resolvable count
    expect(l1!.cogs).toBeNull();   // dry-run wrote nothing
  });
});
