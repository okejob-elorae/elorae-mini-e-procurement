import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getFieldReturnById } from "./queries";

/**
 * DB-touching: the fixture writes real Item/Store/FieldSalesOrder/FieldSalesDelivery(Line)/
 * FieldReturn(Line) rows directly, bypassing the field-sales and field-retur writers (both out
 * of scope here). Never run against the shared prod DB (port 3307 tunnel / VPS host).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getFieldReturnById — pricing fields (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let deliveryLineId = "";
  let returnId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    userId = "";
    orderId = "";
    deliveryId = "";
    deliveryLineId = "";
    returnId = "";
    lineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRQ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-FRQ-${token}`,
        nameId: "Retur query item",
        nameEn: "Retur query item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRQ-STORE-${token}`, name: "Test Query Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-frq-${token}@example.com`, name: "Test Query User" } });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FRQ-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 1_000_000,
        total: 1_000_000,
        lines: {
          create: [{ itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 }],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    const orderLine = order.lines[0];

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FRQ-DLV-${token}`,
        orderId,
        deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredById: userId,
        invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-08T00:00:00.000Z"),
        subtotal: 1_000_000,
        total: 1_000_000,
        lines: {
          create: [
            { orderLineId: orderLine.id, itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 },
          ],
        },
      },
      include: { lines: true },
    });
    deliveryId = delivery.id;
    deliveryLineId = delivery.lines[0].id;

    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-FRQ-RET-${token}`,
        storeId,
        raisedById: userId,
        status: "PENDING_APPROVAL",
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
      },
    });
    returnId = ret.id;

    const line = await prisma.fieldReturnLine.create({
      data: { returnId, itemId, variantSku: "M", qty: 2, reason: "UNSOLD" },
    });
    lineId = line.id;
  });

  afterEach(async () => {
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("resolves priceState AUTO and attaches priceCandidates for a not-yet-approved line, for a canManage viewer", async () => {
    const detail = await getFieldReturnById(returnId, { canManage: true });
    expect(detail).not.toBeNull();
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceState).toBe("AUTO");
    expect(line.priceCandidates).toHaveLength(1);
    expect(line.priceCandidates![0].deliveryLineId).toBe(deliveryLineId);
  });

  /*
   * A viewer without field_returns:manage can never see LinePriceControls, so resolving
   * candidates for them is pure waste — and, since priceState falls back to computing itself
   * from those candidates, it also means priceState is NOT a reliable read of "would this
   * auto-resolve" for such a viewer. This pins the gate itself: same open, genuinely AUTO line
   * as the test above, but with no canManage (and with `opts` omitted entirely, the real
   * default every existing non-manage caller gets).
   */
  it("omits priceCandidates for a viewer without canManage, even on an open, priceable line", async () => {
    const detail = await getFieldReturnById(returnId);
    expect(detail).not.toBeNull();
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceCandidates).toBeUndefined();
  });

  it("reports priceState SET once an admin has chosen a price, not re-derived from candidates", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "MANUAL", unitPrice: 5000, priceNote: "manual price" },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceState).toBe("SET");
    expect(line.priceSource).toBe("MANUAL");
    expect(line.unitPrice).toBe(5000);
    expect(line.priceNote).toBe("manual price");
  });

  it("resolves priceDeliveryDocNo for a line priced from a real delivery", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: deliveryLineId },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceDeliveryDocNo).toBe(`TEST-FRQ-DLV-${token}`);
  });

  it("renders a line whose provenance delivery line no longer exists", async () => {
    /*
     * priceDeliveryLineId carries no foreign key (relationMode = "prisma"), so the delivery it
     * names can be deleted out from under an approved retur. Provenance must degrade to "not
     * shown", never to a thrown detail page — the same fail-open rule the tax-invoice queue uses
     * for its own orphans.
     */
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: "does-not-exist-anywhere" },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    expect(detail).not.toBeNull();
    expect(detail?.lines[0].priceDeliveryDocNo).toBeNull();
  });

  it("coerces Decimal money fields to numbers and exposes header totalValue/valuationStatus", async () => {
    await prisma.fieldReturn.update({
      where: { id: returnId },
      data: { totalValue: 10000, valuationStatus: "VALUED" },
    });
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { creditedQty: 2, unitPrice: 5000, lineValue: 10000 },
    });
    const detail = await getFieldReturnById(returnId);
    expect(typeof detail!.totalValue).toBe("number");
    expect(detail!.totalValue).toBe(10000);
    expect(detail!.valuationStatus).toBe("VALUED");
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(typeof line.unitPrice).toBe("number");
    expect(line.unitPrice).toBe(5000);
    expect(typeof line.lineValue).toBe("number");
    expect(line.lineValue).toBe(10000);
    expect(line.creditedQty).toBe(2);
  });

  it("omits priceCandidates once the retur is APPROVED, even for a canManage viewer where real candidates exist", async () => {
    /*
     * The item/variant on this line genuinely has a delivery candidate (deliveryLineId) — an
     * implementation that forgot to gate on approval status would attach it here too, so this
     * assertion is falsifiable rather than vacuously true. canManage: true here proves this is
     * the STATUS gate at work, not just the canManage gate the test above already pins.
     */
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { status: "APPROVED" } });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceCandidates).toBeUndefined();
  });
});
