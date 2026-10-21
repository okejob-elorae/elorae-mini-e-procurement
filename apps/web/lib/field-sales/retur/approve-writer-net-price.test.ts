import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { approveFieldReturn } from "./approve-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * A retur of a DISCOUNTED delivery, valued through the real approval path. The delivery is
 * written in the shape `recordFieldSalesDelivery` gives it: each `lineTotal` GROSS
 * (`qty x unitPrice`), the line discount in the line's `discountAmount`, the order discount on
 * the header. Gross 3500 (2 x 1000 + 3 x 500), line discount 100.60 on the first line, order
 * discount 35 on the header: the store was billed 3364.40, so a full retur credits exactly that.
 */
d("approveFieldReturn values a discounted delivery at its net (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let discItemId = "";
  let plainItemId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  let orderId = "";
  let deliveryId = "";
  let returnIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    discItemId = "";
    plainItemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    orderId = "";
    deliveryId = "";
    returnIds = [];

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRN-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const discItem = await prisma.item.create({
      data: { sku: `TEST-FRN-DISC-${token}`, nameId: "Retur net item disc", nameEn: "Retur net item disc", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    discItemId = discItem.id;

    const plainItem = await prisma.item.create({
      data: { sku: `TEST-FRN-PLAIN-${token}`, nameId: "Retur net item plain", nameEn: "Retur net item plain", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 500 },
    });
    plainItemId = plainItem.id;

    await prisma.inventoryValue.create({
      data: { itemId: discItemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 400, totalValue: 4000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: plainItemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 200, totalValue: 2000 },
    });

    const store = await prisma.store.create({
      data: { code: `TEST-FRN-STORE-${token}`, name: "Test Retur Net Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frn-${token}@example.com`, name: "Test Retur Net Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frn-admin-${token}@example.com`, name: "Test Retur Net Admin" } });
    adminId = admin.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FRN-${token}`,
        storeId,
        salesmanId: raisedById,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 3500,
        orderDiscountAmount: 35,
        total: 3364.4,
        lines: {
          create: [
            { itemId: discItemId, variantSku: "", productName: "Disc line", qty: 2, unitPrice: 1000, lineTotal: 2000, discountAmount: 100.6 },
            { itemId: plainItemId, variantSku: "", productName: "Plain line", qty: 3, unitPrice: 500, lineTotal: 1500 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    const discOrderLine = order.lines.find((l) => l.itemId === discItemId)!;
    const plainOrderLine = order.lines.find((l) => l.itemId === plainItemId)!;

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FRN-DLV-${token}`,
        orderId,
        deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredById: raisedById,
        invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-08T00:00:00.000Z"),
        subtotal: 3500,
        discountAmount: 35,
        total: 3364,
        lines: {
          create: [
            { orderLineId: discOrderLine.id, itemId: discItemId, variantSku: "", productName: "Disc line", qty: 2, unitPrice: 1000, discountAmount: 100.6, lineTotal: 2000 },
            { orderLineId: plainOrderLine.id, itemId: plainItemId, variantSku: "", productName: "Plain line", qty: 3, unitPrice: 500, lineTotal: 1500 },
          ],
        },
      },
    });
    deliveryId = delivery.id;
  });

  afterEach(async () => {
    const itemIds = [discItemId, plainItemId];
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds.map(seededId) } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds.map(seededId) } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds.map(seededId) } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds.map(seededId) } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds.map(seededId) } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds.map(seededId) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds.map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds.map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  /* Raises, receives in full (no variance) and approves a retur of the given quantities. */
  const returnAndApprove = async (lines: Array<{ itemId: string; qty: number }>) => {
    const created = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: lines.map((l) => ({ itemId: l.itemId, variantSku: "", qty: l.qty, reason: "UNSOLD" as const })),
    });
    returnIds.push(created.returnId);
    const rows = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(created.returnId) } });
    await receiveFieldReturn({
      returnId: created.returnId,
      receivedById: adminId,
      counts: rows.map((r) => ({ lineId: r.id, receivedQty: r.qty, sellableQty: r.qty, rejectedQty: 0 })),
    });
    await approveFieldReturn({ returnId: created.returnId, approvedById: adminId });
    return prisma.fieldReturn.findUniqueOrThrow({
      where: { id: seededId(created.returnId) },
      include: { lines: true },
    });
  };

  it("credits a full retur of the delivery at what the store was billed, not the gross", async () => {
    const ret = await returnAndApprove([
      { itemId: discItemId, qty: 2 },
      { itemId: plainItemId, qty: 3 },
    ]);
    const disc = ret.lines.find((l) => l.itemId === discItemId)!;
    const plain = ret.lines.find((l) => l.itemId === plainItemId)!;
    /* 2000 - 100.60 - 20 (its 2000/3500 share of the 35 order discount) */
    expect(Number(disc.lineValue)).toBe(1879.4);
    /* 1500 - 15 */
    expect(Number(plain.lineValue)).toBe(1485);
    expect(Number(ret.totalValue)).toBe(3364.4);
    expect(Number(ret.totalValue)).not.toBe(3500);
    expect(ret.valuationStatus).toBe("VALUED");
    expect(disc.priceSource).toBe("DELIVERY");
  });

  it("credits a partial retur of a discounted line per net unit, rounded once", async () => {
    const ret = await returnAndApprove([{ itemId: discItemId, qty: 1 }]);
    const [line] = ret.lines;
    /* 1879.40 over 2 units: one unit credits 939.70, never the 1000 gross unit price. */
    expect(Number(line.lineValue)).toBe(939.7);
    expect(Number(line.unitPrice)).toBe(939.7);
    expect(Number(ret.totalValue)).toBe(939.7);
  });
});
