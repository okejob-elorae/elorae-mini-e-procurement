import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { computeStoreCreditExposure } from "./credit-exposure";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type StatusPiutang = "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF" | "VOIDED";
type BarisUji = { qty: number; unitPrice: number; deliveredQty?: number; cancelledQty?: number; discountAmount?: number };

/*
 * One credit figure (Q10): open receivables (team `outstandingAmount`) plus each approved putus
 * order's value not yet on a nota, measured from its OPEN line quantity. Every receivable fixture
 * writes both column families, as every real writer does (`kolom-piutang.test.ts`).
 */
d("computeStoreCreditExposure (test bed only)", () => {
  let token = "";
  let seq = 0;
  let storeId = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let receivableIds: string[] = [];

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    seq = 0;
    storeId = ""; userId = ""; uomId = ""; itemId = "";
    orderIds = []; deliveryIds = []; receivableIds = [];
    const store = await prisma.store.create({
      data: { code: `TEST-CEX-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({ data: { email: `cex-${token}@test.local`, name: `Sales ${token}` } });
    userId = user.id;
    const uom = await prisma.uOM.create({ data: { code: `TEST-CEX-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-CEX-ITEM-${token}`, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    /* Children before parents; every filter is an explicit seeded id. */
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(receivableIds) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** An order with its lines; `total` defaults to Σ lineTotal − line discounts − orderDiscountAmount. */
  async function pesanan(opts: {
    lines: BarisUji[];
    status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    orderType?: "PUTUS" | "KONSI";
    deliveryStatus?: "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";
    orderDiscountAmount?: number;
    total?: number;
    cancelledById?: string;
  }) {
    seq += 1;
    const gross = opts.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const lineDisc = opts.lines.reduce((s, l) => s + (l.discountAmount ?? 0), 0);
    const orderDisc = opts.orderDiscountAmount ?? 0;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-CEX-ORD-${token}-${seq}`,
        storeId,
        salesmanId: userId,
        status: opts.status ?? "APPROVED",
        orderType: opts.orderType ?? "PUTUS",
        deliveryStatus: opts.deliveryStatus ?? "PENDING",
        subtotal: gross,
        orderDiscountAmount: orderDisc,
        total: opts.total ?? gross - lineDisc - orderDisc,
        ...(opts.cancelledById ? { cancelledById: opts.cancelledById, cancelledAt: new Date() } : {}),
        lines: {
          create: opts.lines.map((l) => ({
            itemId,
            variantSku: "",
            productName: "T",
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.qty * l.unitPrice,
            discountAmount: l.discountAmount ?? 0,
            deliveredQty: l.deliveredQty ?? 0,
            cancelledQty: l.cancelledQty ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
    orderIds.push(order.id);
    return order;
  }

  /** A nota row (delivery + its lines) for `orderId`. */
  async function nota(orderId: string, lines: Array<{ orderLineId: string; qty: number }>, total: number) {
    seq += 1;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-CEX-DLV-${token}-${seq}`,
        orderId,
        deliveredAt: new Date(),
        deliveredById: userId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: total,
        total,
        lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, itemId, variantSku: "", productName: "T", qty: l.qty })) },
      },
    });
    deliveryIds.push(delivery.id);
    return delivery.id;
  }

  /** A receivable with both column families; a nota's when `deliveryId` is given, a manual invoice otherwise. */
  async function piutang(opts: { amount: number; outstanding?: number; status: StatusPiutang; deliveryId?: string }) {
    seq += 1;
    const sisa = opts.outstanding ?? opts.amount;
    const r = await prisma.receivable.create({
      data: {
        storeId,
        invoiceNo: `TEST-CEX-INV-${token}-${seq}`,
        ...(opts.deliveryId ? { deliveryId: opts.deliveryId, source: "DELIVERY" as const } : { source: "MANUAL" as const }),
        invoiceDate: new Date(),
        dueDate: new Date(),
        amount: opts.amount,
        outstanding: sisa,
        originalAmount: opts.amount,
        outstandingAmount: sisa,
        paidAmount: opts.status === "PARTIAL" || opts.status === "PAID" ? opts.amount - sisa : 0,
        status: opts.status,
      },
    });
    receivableIds.push(r.id);
    return r.id;
  }

  it("a store with neither receivables nor approved orders has zero exposure", async () => {
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure).toEqual({ receivableOutstanding: 0, undeliveredOrderResidual: 0, openInvoiceCount: 0, openReceivableIds: [], total: 0 });
  });

  it("sums OUTSTANDING and PARTIAL receivables, excludes WRITTEN_OFF and PAID", async () => {
    for (const [amount, outstanding, status] of [
      [100_000, 100_000, "OUTSTANDING"],
      [50_000, 20_000, "PARTIAL"],
      [30_000, 30_000, "WRITTEN_OFF"],
      [10_000, 0, "PAID"],
    ] as const) {
      const order = await pesanan({ lines: [], total: amount, deliveryStatus: "DELIVERED" });
      await piutang({ amount, outstanding, status, deliveryId: await nota(order.id, [], amount) });
    }

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBe(120_000);
    // Line-less orders have no open quantity, so they add nothing.
    expect(exposure.undeliveredOrderResidual).toBe(0);
    expect(exposure.total).toBe(120_000);
  });

  it("counts and names the open invoices: a sub-rupiah residue is summed but not counted, settled ones are in neither", async () => {
    const a = await piutang({ amount: 100_000, status: "OUTSTANDING" });
    const b = await piutang({ amount: 50_000, outstanding: 20_000, status: "PARTIAL" });
    await piutang({ amount: 10_000, outstanding: 0.4, status: "PARTIAL" });
    await piutang({ amount: 10_000, outstanding: 0, status: "PAID" });
    await piutang({ amount: 30_000, status: "WRITTEN_OFF" });
    await piutang({ amount: 40_000, outstanding: 0, status: "VOIDED" });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBeCloseTo(120_000.4, 2);
    expect(exposure.openInvoiceCount).toBe(2);
    expect([...exposure.openReceivableIds].sort()).toEqual([a, b].sort());
  });

  it("values an approved order's open line quantity with the order discount pro-rated (144.000)", async () => {
    // A 10 × 10.000 with 4 on a nota, B 5 × 20.000 untouched, order discount 20.000, total 180.000.
    await pesanan({
      lines: [
        { qty: 10, unitPrice: 10_000, deliveredQty: 4 },
        { qty: 5, unitPrice: 20_000 },
      ],
      orderDiscountAmount: 20_000,
      deliveryStatus: "PARTIAL",
    });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    // Open gross 60.000 + 100.000 = 160.000; order discount share 20.000 × 160/200 = 16.000.
    expect(exposure.undeliveredOrderResidual).toBe(144_000);
    expect(exposure.openInvoiceCount).toBe(0);
  });

  it("an over-delivered line floors its order at zero, never lending headroom to a sibling order", async () => {
    await pesanan({ lines: [{ qty: 10, unitPrice: 5_000, deliveredQty: 12 }], deliveryStatus: "DELIVERED" });
    await pesanan({ lines: [{ qty: 3, unitPrice: 10_000 }] });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.undeliveredOrderResidual).toBe(30_000);
  });

  it("the owner's example: 4 of 16 pcs on a nota (1 jt) and a 15 jt invoice → 16 jt + 3 jt belum dinota = 19 jt", async () => {
    const order = await pesanan({ lines: [{ qty: 16, unitPrice: 250_000, deliveredQty: 4 }], deliveryStatus: "PARTIAL" });
    const deliveryId = await nota(order.id, [{ orderLineId: order.lines[0].id, qty: 4 }], 1_000_000);
    await piutang({ amount: 1_000_000, status: "OUTSTANDING", deliveryId });
    await piutang({ amount: 15_000_000, status: "OUTSTANDING" });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBe(16_000_000);
    expect(exposure.undeliveredOrderResidual).toBe(3_000_000);
    expect(exposure.total).toBe(19_000_000);
    expect(exposure.openInvoiceCount).toBe(2);
  });

  it("'tidak jadi dikirim' (P16/P25): the voided nota leaves the receivables and its pieces reopen — back to the pre-shipment figure", async () => {
    const order = await pesanan({ lines: [{ qty: 10, unitPrice: 10_000 }] });
    const before = await computeStoreCreditExposure(prisma, storeId);
    expect(before.total).toBe(100_000);

    // The void writer's end state: receivable VOIDED (both balances 0), deliveredQty back to 0, status recomputed.
    const deliveryId = await nota(order.id, [{ orderLineId: order.lines[0].id, qty: 10 }], 100_000);
    await piutang({ amount: 100_000, outstanding: 0, status: "VOIDED", deliveryId });
    expect(await computeStoreCreditExposure(prisma, storeId)).toEqual(before);
  });

  it("a nota corrected at handover (P24, lost in transit) counts once: pieces delivered or cancelled add 0, reopened pieces count again", async () => {
    const order = await pesanan({ lines: [{ qty: 20, unitPrice: 10_000, deliveredQty: 20 }], deliveryStatus: "DELIVERED" });
    const lineId = order.lines[0].id;
    const deliveryId = await nota(order.id, [{ orderLineId: lineId, qty: 10 }], 100_000);
    // The receivable is corrected to the 10 pcs received (amount and originalAmount both).
    await piutang({ amount: 100_000, status: "OUTSTANDING", deliveryId });

    // Lost in transit: the lost pieces stay delivered → nothing is "belum dinota".
    const lost = await computeStoreCreditExposure(prisma, storeId);
    expect(lost.undeliveredOrderResidual).toBe(0);
    expect(lost.total).toBe(100_000);

    // Or the remainder closed: delivered 10 + cancelled 10.
    await prisma.fieldSalesOrderLine.update({ where: { id: lineId }, data: { deliveredQty: 10, cancelledQty: 10 } });
    await prisma.fieldSalesOrder.update({ where: { id: order.id }, data: { deliveryStatus: "CLOSED" } });
    const closed = await computeStoreCreditExposure(prisma, storeId);
    expect(closed.undeliveredOrderResidual).toBe(0);
    expect(closed.total).toBe(100_000);

    // Retur langsung: the refused 10 pcs leave deliveredQty and reopen.
    await prisma.fieldSalesOrderLine.update({ where: { id: lineId }, data: { deliveredQty: 10, cancelledQty: 0 } });
    await prisma.fieldSalesOrder.update({ where: { id: order.id }, data: { deliveryStatus: "PARTIAL" } });
    const reopened = await computeStoreCreditExposure(prisma, storeId);
    expect(reopened.undeliveredOrderResidual).toBe(100_000);
    expect(reopened.total).toBe(200_000);
  });

  it("a DELIVERED order still holding open pieces is read — never trusted to have recomputed its status", async () => {
    // A writer that reopened pieces but left a stale DELIVERED must not wave them through.
    await pesanan({ lines: [{ qty: 10, unitPrice: 10_000, deliveredQty: 6 }], deliveryStatus: "DELIVERED" });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.undeliveredOrderResidual).toBe(40_000);
  });

  it("pending, rejected, cancelled-by-salesman and konsi orders add nothing", async () => {
    const baris = [{ qty: 10, unitPrice: 10_000 }];
    await pesanan({ lines: baris, status: "PENDING_APPROVAL" });
    await pesanan({ lines: baris, status: "REJECTED" });
    await pesanan({ lines: baris, status: "REJECTED", cancelledById: userId });
    await pesanan({ lines: baris, orderType: "KONSI" });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.undeliveredOrderResidual).toBe(0);
    expect(exposure.total).toBe(0);
  });

  it("a closeFieldSalesOrderRemainder'd order stops contributing residual for its written-off remainder — only the delivered portion's receivable counts", async () => {
    /*
     * Regression for the bug where a closed remainder's residual (order.total - delivered) was
     * counted forever, because closeFieldSalesOrderRemainder never changes order.total or
     * order.status — it only settles the lines (deliveredQty/cancelledQty) and flips
     * deliveryStatus to CLOSED. Mirrors that writer's exact end state: 40 of 100 units delivered
     * (real delivery + receivable), the remaining 60 cancelled, deliveryStatus CLOSED.
     */
    const order = await pesanan({ lines: [{ qty: 100, unitPrice: 1000 }] });
    const line = order.lines[0];
    const deliveryId = await nota(order.id, [{ orderLineId: line.id, qty: 40 }], 40_000);
    await piutang({ amount: 40_000, status: "OUTSTANDING", deliveryId });
    await prisma.fieldSalesOrderLine.update({ where: { id: line.id }, data: { deliveredQty: 40, cancelledQty: 60 } });
    await prisma.fieldSalesOrder.update({
      where: { id: order.id },
      data: { deliveryStatus: "CLOSED", closedAt: new Date(), closedById: userId, closeReason: "test" },
    });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBe(40_000);
    expect(exposure.undeliveredOrderResidual).toBe(0);
    expect(exposure.total).toBe(40_000);
  });
});
