import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listTaxInvoices } from "./queries";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";

/* Stock-mutating (goes through the real delivery writer) — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Newer nota first, so `orderBy: { delivery: { invoiceDate: "desc" } }` puts A on page 1. */
const invoiceDateA = new Date("2026-02-01T00:00:00.000+07:00");
const dueDateA = new Date("2026-02-08T00:00:00.000+07:00");
const invoiceDateB = new Date("2026-01-01T00:00:00.000+07:00");
const dueDateB = new Date("2026-01-08T00:00:00.000+07:00");

d("listTaxInvoices (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  /**
   * Every query below is scoped by `q` to this run's own store name. The bed is shared with real
   * data, so an unscoped assertion on `counts` or `total` would depend on whatever else is in the
   * table.
   */
  const storeName = `Test TIQ Store ${token}`;

  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  /* Only B's id is held: the teardown scopes on `orderId`, and B is the row flipped to CREATED. */
  let deliveryBId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineId = "";
    deliveryBId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-TIQ-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-TIQ-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 20, reservedQty: 10, avgCost: 500, totalValue: 10000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-TIQ-STORE-${token}`, name: storeName, address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-tiq-${token}@example.com`, name: "Test TIQ Finance" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-TIQ-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 10000,
        total: 10000,
        lines: {
          create: [{ itemId, variantSku: "", productName: "Test TIQ Product", qty: 10, unitPrice: 1000, lineTotal: 10000 }],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 10, state: "RESERVED" },
    });

    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 5 }],
      invoiceDate: invoiceDateA,
      dueDate: dueDateA,
    });

    const deliveryB = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 5 }],
      invoiceDate: invoiceDateB,
      dueDate: dueDateB,
    });
    deliveryBId = deliveryB.deliveryId;

    /* B is the CREATED one; A stays PENDING. Set directly — the transition itself is the writer
       spec's subject, and going through it would add audit rows this teardown does not own. */
    await prisma.taxInvoice.update({
      where: { deliveryId: deliveryBId },
      data: { status: "CREATED", invoiceNo: `010.000-26.${token}`, markedAt: new Date(), markedById: userId },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("returns both rows with plain-number totals and the delivery fields joined in", async () => {
    const { rows, total } = await listTaxInvoices({ q: storeName, page: 1, perPage: 10 });

    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      /* Decimal-leak guard: the delivery total must already be a plain number, never a Decimal. */
      expect(typeof row.total).toBe("number");
      expect(row.total).toBe(5000);
      expect(row.storeName).toBe(storeName);
      expect(row.orderId).toBe(orderId);
      expect(row.docNo).not.toBe("");
    }

    const created = rows.find((r) => r.status === "CREATED");
    expect(created?.invoiceNo).toBe(`010.000-26.${token}`);
    expect(rows.find((r) => r.status === "PENDING")?.invoiceNo).toBeNull();
  });

  it("keeps every bucket's count intact when a status filter is applied", async () => {
    const unfiltered = await listTaxInvoices({ q: storeName, page: 1, perPage: 10 });
    expect(unfiltered.counts).toMatchObject({ PENDING: 1, CREATED: 1, NOT_REQUIRED: 0 });

    /**
     * The tabs read "how many PENDING match my current search", not "how many rows am I looking
     * at" — so the status term is deliberately dropped from the counts query while `q` is kept.
     * A count that collapsed onto the active tab would make every other tab read 0.
     */
    const filtered = await listTaxInvoices({ q: storeName, status: "PENDING", page: 1, perPage: 10 });
    expect(filtered.total).toBe(1);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].status).toBe("PENDING");
    expect(filtered.counts).toMatchObject({ PENDING: 1, CREATED: 1, NOT_REQUIRED: 0 });
  });

  it("pages through the ordered result set", async () => {
    const first = await listTaxInvoices({ q: storeName, page: 1, perPage: 1 });
    const second = await listTaxInvoices({ q: storeName, page: 2, perPage: 1 });

    /* Both pages report the full match count, and each carries exactly one of the two rows. */
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);

    /* Newest invoiceDate first — A (Feb) leads, B (Jan) lands on page 2. */
    expect(first.rows[0].invoiceDate.getTime()).toBe(invoiceDateA.getTime());
    expect(second.rows[0].invoiceDate.getTime()).toBe(invoiceDateB.getTime());
    expect(second.rows[0].dueDate.getTime()).toBe(dueDateB.getTime());
    expect(first.rows[0].id).not.toBe(second.rows[0].id);
  });

  it("finds a row by its faktur number", async () => {
    const { rows, total } = await listTaxInvoices({ q: `010.000-26.${token}`, page: 1, perPage: 10 });
    expect(total).toBe(1);
    expect(rows[0].status).toBe("CREATED");
    expect(rows[0].invoiceNo).toBe(`010.000-26.${token}`);
  });
});
