import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getSalesmenSalesSummary } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getSalesmenSalesSummary (test bed only)", () => {
  const tag = `SMS-${Math.random().toString(36).slice(2, 10)}`;
  let storeId = "";
  let salesmanAId = "";
  let salesmanBId = "";
  let uomId = "";
  let itemId = "";
  const fsoIds: string[] = [];
  const vanSaleIds: string[] = [];

  beforeEach(async () => {
    storeId = "";
    salesmanAId = "";
    salesmanBId = "";
    uomId = "";
    itemId = "";
    const store = await prisma.store.create({
      data: { code: tag, name: "T", address: "T", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const salesmanA = await prisma.user.create({
      data: { email: `${tag}-a@test.local`, name: "Salesman A" },
    });
    const salesmanB = await prisma.user.create({
      data: { email: `${tag}-b@test.local`, name: "Salesman B" },
    });
    salesmanAId = salesmanA.id;
    salesmanBId = salesmanB.id;
  });

  afterEach(async () => {
    await prisma.vanSale.deleteMany({ where: { id: { in: vanSaleIds.map(seededId) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { delivery: { orderId: { in: fsoIds.map(seededId) } } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: { in: fsoIds.map(seededId) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: fsoIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: fsoIds.map(seededId) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesmanAId, salesmanBId].map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    fsoIds.length = 0;
    vanSaleIds.length = 0;
  });

  async function makeOrder(
    seq: number,
    salesmanId: string,
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED",
    orderType: "PUTUS" | "KONSI",
    total: number,
    deliveryStatus: "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED" = "PENDING"
  ) {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${seq}`,
        storeId,
        salesmanId,
        status,
        orderType,
        subtotal: total,
        total,
        deliveryStatus,
      },
    });
    fsoIds.push(order.id);
    return order;
  }

  /* Realised is what shipped, so an approved order only counts once it carries a delivery. */
  async function makeDelivery(seq: number, orderId: string, deliveredById: string, total: number) {
    return prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${seq}`,
        orderId,
        deliveredAt: new Date(),
        deliveredById,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: total,
        total,
      },
    });
  }

  async function makeVanSale(seq: number, salesmanId: string, total: number) {
    const sale = await prisma.vanSale.create({
      data: {
        docNo: `${tag}-VS-${seq}`,
        salesmanId,
        subtotal: total,
        total,
        amountPaid: total,
        changeAmount: 0,
      },
    });
    vanSaleIds.push(sale.id);
    return sale;
  }

  it("realised = delivered putus + van sale; outstanding = pending putus; konsi/rejected excluded; fully delivered orders are not awaiting delivery; sorted by realised desc; totals correct", async () => {
    // Salesman A: approved putus 1000 delivered in full, pending putus 500, konsi approved 300 (excluded), rejected putus 200 (excluded), van sale 400
    /* Fully delivered, so the writer would have flipped deliveryStatus to DELIVERED — the fixture must say so too. */
    const orderA = await makeOrder(1, salesmanAId, "APPROVED", "PUTUS", 1000, "DELIVERED");
    await makeDelivery(1, orderA.id, salesmanAId, 1000);
    await makeOrder(2, salesmanAId, "PENDING_APPROVAL", "PUTUS", 500);
    await makeOrder(3, salesmanAId, "APPROVED", "KONSI", 300);
    await makeOrder(4, salesmanAId, "REJECTED", "PUTUS", 200);
    await makeVanSale(1, salesmanAId, 400);

    // Salesman B: approved putus 2000 delivered in full, pending putus 100, van sale 50
    const orderB = await makeOrder(5, salesmanBId, "APPROVED", "PUTUS", 2000, "DELIVERED");
    await makeDelivery(2, orderB.id, salesmanBId, 2000);
    await makeOrder(6, salesmanBId, "PENDING_APPROVAL", "PUTUS", 100);
    await makeVanSale(2, salesmanBId, 50);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    const rowB = summary.rows.find((r) => r.salesmanId === salesmanBId);

    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    // 1000 delivered putus + 400 van = 1400, 2 realised transactions (1 delivery + 1 van sale)
    expect(rowA!.realised).toEqual({ count: 2, amount: 1400 });
    // Rinciannya disebut apa adanya — "2 transaksi" membuka daftar pesanan yang berisi 1.
    expect(rowA!.realisedRincian).toEqual({ pengiriman: 1, van: 1, pesanan: 1 });
    expect(rowA!.outstanding).toEqual({ count: 1, amount: 500 });
    expect(rowA!.awaitingDelivery).toEqual({ count: 0, amount: 0 });
    expect(rowA!.menungguKirim).toEqual({ count: 0, amount: 0 });
    // 2000 delivered putus + 50 van = 2050
    expect(rowB!.realised).toEqual({ count: 2, amount: 2050 });
    expect(rowB!.outstanding).toEqual({ count: 1, amount: 100 });
    expect(rowB!.awaitingDelivery).toEqual({ count: 0, amount: 0 });

    // sorted by realised desc: B (2050) before A (1400)
    const idxA = summary.rows.findIndex((r) => r.salesmanId === salesmanAId);
    const idxB = summary.rows.findIndex((r) => r.salesmanId === salesmanBId);
    expect(idxB).toBeLessThan(idxA);

    // grand totals include at least our contributed amounts (shared test-bed DB may carry other real salesmen rows)
    const otherRealised = summary.totals.realised.amount - rowA!.realised.amount - rowB!.realised.amount;
    const otherOutstanding = summary.totals.outstanding.amount - rowA!.outstanding.amount - rowB!.outstanding.amount;
    expect(otherRealised).toBeGreaterThanOrEqual(0);
    expect(otherOutstanding).toBeGreaterThanOrEqual(0);
    expect(summary.totals.realised.count).toBeGreaterThanOrEqual(rowA!.realised.count + rowB!.realised.count);
    expect(summary.totals.outstanding.count).toBeGreaterThanOrEqual(
      rowA!.outstanding.count + rowB!.outstanding.count
    );
  });

  it("counts what shipped, not what was approved: no delivery means no realised value, a partial delivery counts only itself", async () => {
    /* Approved and never delivered — the goods are still in the warehouse, so nothing is realised. */
    await makeOrder(7, salesmanAId, "APPROVED", "PUTUS", 900);
    /* Approved for 800, only 300 of it shipped. */
    const partly = await makeOrder(8, salesmanBId, "APPROVED", "PUTUS", 800, "PARTIAL");
    await makeDelivery(3, partly.id, salesmanBId, 300);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    const rowB = summary.rows.find((r) => r.salesmanId === salesmanBId);
    expect(rowA!.realised).toEqual({ count: 0, amount: 0 });
    expect(rowB!.realised).toEqual({ count: 1, amount: 300 });
    expect(rowB!.menungguKirim).toEqual({ count: 0, amount: 0 });
  });

  it("satu pesanan yang dikirim dua kali: dua pengiriman, SATU pesanan (angka yang dicocokkan dengan daftar pesanan)", async () => {
    const order = await makeOrder(14, salesmanAId, "APPROVED", "PUTUS", 800, "DELIVERED");
    await makeDelivery(4, order.id, salesmanAId, 300);
    await makeDelivery(5, order.id, salesmanAId, 500);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA!.realised).toEqual({ count: 2, amount: 800 });
    expect(rowA!.realisedRincian).toEqual({ pengiriman: 2, van: 0, pesanan: 1 });
    expect(summary.totals.realisedRincian.pesanan).toBeGreaterThanOrEqual(1);
  });

  it("pesanan putus yang sudah disetujui tetapi belum dikirim punya embernya sendiri — tidak hilang dari kedua angka", async () => {
    // Sama dengan daftar `?kirim=PENDING`: DISETUJUI, PUTUS, belum satu pun pengiriman.
    await makeOrder(9, salesmanAId, "APPROVED", "PUTUS", 900);
    await makeOrder(10, salesmanAId, "APPROVED", "PUTUS", 100);
    await makeOrder(11, salesmanAId, "APPROVED", "KONSI", 700); // transfer, bukan penjualan
    await makeOrder(12, salesmanAId, "PENDING_APPROVAL", "PUTUS", 50); // masih menunggu persetujuan
    await makeOrder(13, salesmanAId, "REJECTED", "PUTUS", 60); // ditolak/dibatalkan

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA!.menungguKirim).toEqual({ count: 2, amount: 1000 });
    expect(rowA!.outstanding).toEqual({ count: 1, amount: 50 });
    expect(rowA!.realised).toEqual({ count: 0, amount: 0 });
    expect(summary.totals.menungguKirim.count).toBeGreaterThanOrEqual(2);
  });

  it("awaitingDelivery: an approved putus order with no delivery counts at its full total, and its salesman gets a row", async () => {
    await makeOrder(9, salesmanAId, "APPROVED", "PUTUS", 900);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA).toBeDefined();
    expect(rowA!.awaitingDelivery).toEqual({ count: 1, amount: 900 });
    expect(rowA!.realised).toEqual({ count: 0, amount: 0 });
    expect(rowA!.outstanding).toEqual({ count: 0, amount: 0 });
  });

  it("awaitingDelivery: a partly delivered order counts the residual while realised counts the delivery", async () => {
    const order = await makeOrder(10, salesmanBId, "APPROVED", "PUTUS", 800, "PARTIAL");
    await makeDelivery(4, order.id, salesmanBId, 300);

    const summary = await getSalesmenSalesSummary();
    const rowB = summary.rows.find((r) => r.salesmanId === salesmanBId);
    expect(rowB!.awaitingDelivery).toEqual({ count: 1, amount: 500 });
    expect(rowB!.realised).toEqual({ count: 1, amount: 300 });
  });

  it("awaitingDelivery: subtracts a delivery's exact goods value, not its whole-rupiah total", async () => {
    /**
     * A 2-unit line at 999.70 (a store-discounted price) with a 100 line discount: order total
     * 1899.40. Shipping 1 unit takes the pro-rated 50, so that delivery's exact goods value is
     * 949.70 while the writer charges `total` 950. What is still awaiting delivery is the other
     * 949.70 — subtracting the rounded total would report 949.40. A non-closing delivery's
     * discount share is always whole rupiah, so the sen here come from the unit price.
     */
    const uom = await prisma.uOM.create({ data: { code: `${tag}-UOM`, nameId: "test", nameEn: "test" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `${tag}-ITEM`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 999.7 },
    });
    itemId = item.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-19`,
        storeId,
        salesmanId: salesmanBId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 1999.4,
        total: 1899.4,
        deliveryStatus: "PARTIAL",
        lines: {
          create: [{ itemId, variantSku: "", productName: "test", qty: 2, unitPrice: 999.7, lineTotal: 1999.4, discountAmount: 100, deliveredQty: 1 }],
        },
      },
      include: { lines: true },
    });
    fsoIds.push(order.id);
    await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-8`,
        orderId: order.id,
        deliveredAt: new Date(),
        deliveredById: salesmanBId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 999.7,
        total: 950,
        lines: {
          create: [{ orderLineId: order.lines[0].id, itemId, variantSku: "", productName: "test", qty: 1, unitPrice: 999.7, discountAmount: 50, lineTotal: 999.7 }],
        },
      },
    });

    const summary = await getSalesmenSalesSummary();
    const rowB = summary.rows.find((r) => r.salesmanId === salesmanBId);
    expect(rowB!.awaitingDelivery.count).toBe(1);
    expect(rowB!.awaitingDelivery.amount).toBeCloseTo(949.7, 6);
    expect(rowB!.realised).toEqual({ count: 1, amount: 950 });
  });

  it("awaitingDelivery: floors the residual per order, so an over-delivered order lends nothing to a sibling", async () => {
    const over = await makeOrder(11, salesmanAId, "APPROVED", "PUTUS", 100, "PARTIAL");
    await makeDelivery(5, over.id, salesmanAId, 150);
    await makeOrder(12, salesmanAId, "APPROVED", "PUTUS", 400);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA!.awaitingDelivery).toEqual({ count: 2, amount: 400 });
  });

  it("awaitingDelivery: delivered, closed, konsi, pending and rejected orders are not in it; pending stays outstanding", async () => {
    const delivered = await makeOrder(13, salesmanAId, "APPROVED", "PUTUS", 700, "DELIVERED");
    await makeDelivery(6, delivered.id, salesmanAId, 700);
    const closed = await makeOrder(14, salesmanAId, "APPROVED", "PUTUS", 600, "CLOSED");
    await makeDelivery(7, closed.id, salesmanAId, 200);
    await makeOrder(15, salesmanAId, "APPROVED", "KONSI", 300);
    await makeOrder(16, salesmanAId, "PENDING_APPROVAL", "PUTUS", 500);
    await makeOrder(17, salesmanAId, "REJECTED", "PUTUS", 200);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA!.awaitingDelivery).toEqual({ count: 0, amount: 0 });
    expect(rowA!.outstanding).toEqual({ count: 1, amount: 500 });
    expect(rowA!.realised).toEqual({ count: 2, amount: 900 });
  });

  it("totals include the awaitingDelivery bucket", async () => {
    await makeOrder(18, salesmanAId, "APPROVED", "PUTUS", 900);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    expect(rowA!.awaitingDelivery).toEqual({ count: 1, amount: 900 });
    /* Exact within one call even on the shared bed: totals are the fold of the rows returned beside them. */
    const rowSum = summary.rows.reduce(
      (acc, r) => ({ count: acc.count + r.awaitingDelivery.count, amount: acc.amount + r.awaitingDelivery.amount }),
      { count: 0, amount: 0 },
    );
    expect(summary.totals.awaitingDelivery.count).toBe(rowSum.count);
    expect(summary.totals.awaitingDelivery.amount).toBeCloseTo(rowSum.amount, 6);
  });

  it("returns no row for a salesman with no eligible orders/van sales", async () => {
    const summary = await getSalesmenSalesSummary();
    expect(summary.rows.some((r) => r.salesmanId === salesmanAId)).toBe(false);
    expect(summary.rows.some((r) => r.salesmanId === salesmanBId)).toBe(false);
  });
});
