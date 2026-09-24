import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listTaxInvoices } from "./queries";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";

/* Stock-mutating (goes through the real delivery writer) — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* A has the newer invoice date but the older faktur: createdAt desc puts B on page 1, an invoiceDate sort would put A. */
const invoiceDateA = new Date("2026-02-01T00:00:00.000+07:00");
const dueDateA = new Date("2026-02-08T00:00:00.000+07:00");
const invoiceDateB = new Date("2026-01-01T00:00:00.000+07:00");
const dueDateB = new Date("2026-01-08T00:00:00.000+07:00");

d("listTaxInvoices (test bed only)", () => {
  /**
   * Every query below is scoped by `q` to this test's own store name. The bed is shared with real
   * data, so an unscoped assertion on `counts` or `total` would depend on whatever else is in the
   * table. Both are regenerated per test, not per file: a single `afterEach` that throws or times
   * out would otherwise leave every later test colliding on the same `@unique` values.
   */
  let token = "";
  let storeName = "";

  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  /* The teardown scopes on `orderId`; both delivery ids are held only so a test can flip one
     tax invoice's status directly. */
  let deliveryAId = "";
  let deliveryBId = "";

  /**
   * Sell-through source coverage: a separate store/report/faktur chain, independent of the
   * delivery fixture above, scoped by its own `q` so it never collides with the unfiltered
   * `counts`/`total` assertions the existing DELIVERY tests make on `storeName`.
   */
  let sellThroughStoreName = "";
  let sellThroughStoreId = "";
  let sellThroughSalesmanId = "";
  let sellThroughId = "";
  let sellThroughDocNo = "";
  let sellThroughTaxInvoiceId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeName = `Test TIQ Store ${token}`;
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineId = "";
    deliveryAId = ""; deliveryBId = "";
    sellThroughStoreName = ""; sellThroughStoreId = ""; sellThroughSalesmanId = ""; sellThroughId = "";
    sellThroughDocNo = ""; sellThroughTaxInvoiceId = "";

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

    const deliveryA = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 5 }],
      invoiceDate: invoiceDateA,
      dueDate: dueDateA,
    });
    deliveryAId = deliveryA.deliveryId;

    const deliveryB = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 5 }],
      invoiceDate: invoiceDateB,
      dueDate: dueDateB,
    });
    deliveryBId = deliveryB.deliveryId;

    /**
     * Pin creation order explicitly, and against the invoice dates: both writes can land within the
     * same millisecond otherwise, and an order that agreed with invoiceDate could not tell the two
     * sort keys apart.
     */
    await prisma.taxInvoice.update({
      where: { deliveryId: deliveryAId },
      data: { createdAt: new Date("2026-01-02T00:00:00.000+07:00") },
    });
    await prisma.taxInvoice.update({
      where: { deliveryId: deliveryBId },
      data: { createdAt: new Date("2026-02-02T00:00:00.000+07:00") },
    });

    /* B is the CREATED one; A stays PENDING. Set directly — the transition itself is the writer
       spec's subject, and going through it would add audit rows this teardown does not own. */
    await prisma.taxInvoice.update({
      where: { deliveryId: deliveryBId },
      data: { status: "CREATED", invoiceNo: `010.000-26.${token}`, markedAt: new Date(), markedById: userId },
    });

    /* Sell-through source: its own store, its own salesman, a KonsiSellThrough report created
       directly (no writer for it exists yet), and a TaxInvoice backed by `sellThroughId` alone. */
    sellThroughStoreName = `Test TIQ ST Store ${token}`;
    const sellThroughStore = await prisma.store.create({
      data: { code: `TEST-TIQ-ST-STORE-${token}`, name: sellThroughStoreName, address: "Test address", termsType: "KONSI", isActive: true },
    });
    sellThroughStoreId = sellThroughStore.id;

    const sellThroughSalesman = await prisma.user.create({
      data: { email: `test-tiq-st-${token}@example.com`, name: "Test TIQ ST Salesman" },
    });
    sellThroughSalesmanId = sellThroughSalesman.id;

    sellThroughDocNo = `TEST-TIQ-KST-${token}`;
    const sellThrough = await prisma.konsiSellThrough.create({
      data: {
        docNo: sellThroughDocNo,
        storeId: sellThroughStoreId,
        method: "SPG_POS",
        closingStocktakeId: `TEST-TIQ-STK-${token}`,
        periodEnd: new Date("2026-03-31T00:00:00.000+07:00"),
        salesmanId: sellThroughSalesmanId,
        createdById: userId,
      },
    });
    sellThroughId = sellThrough.id;

    const sellThroughTaxInvoice = await prisma.taxInvoice.create({
      data: { sellThroughId, status: "PENDING" },
    });
    sellThroughTaxInvoiceId = sellThroughTaxInvoice.id;
  });

  afterEach(async () => {
    /* Children of the 1:1 relation to KonsiSellThrough go before their parent. */
    await prisma.taxInvoice.deleteMany({ where: { id: seededId(sellThroughTaxInvoiceId) } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: seededId(sellThroughId) } });
    await prisma.store.deleteMany({ where: { id: seededId(sellThroughStoreId) } });
    await prisma.user.deleteMany({ where: { id: seededId(sellThroughSalesmanId) } });

    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
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

    /* Newest faktur first — B leads despite its older invoice date, A lands on page 2. */
    expect(first.rows[0].invoiceDate?.getTime()).toBe(invoiceDateB.getTime());
    expect(first.rows[0].dueDate?.getTime()).toBe(dueDateB.getTime());
    expect(second.rows[0].invoiceDate?.getTime()).toBe(invoiceDateA.getTime());
    expect(first.rows[0].id).not.toBe(second.rows[0].id);
  });

  it("finds a row by its faktur number", async () => {
    const { rows, total } = await listTaxInvoices({ q: `010.000-26.${token}`, page: 1, perPage: 10 });
    expect(total).toBe(1);
    expect(rows[0].status).toBe("CREATED");
    expect(rows[0].invoiceNo).toBe(`010.000-26.${token}`);
  });

  it("exposes the store's id and NPWP on each row", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { npwp: "01.234.567.8-901.000" } });
    const { rows } = await listTaxInvoices({ q: storeName, page: 1, perPage: 10 });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.storeId).toBe(storeId);
      expect(row.storeNpwp).toBe("01.234.567.8-901.000");
    }
  });

  it("counts and filters the SENT_TO_STORE bucket", async () => {
    /* A is the PENDING one — flipped directly, same as the `beforeEach` does for B, because the
       subject here is the query layer and going through the writer would drag its audit rows in. */
    const sent = await prisma.taxInvoice.update({
      where: { deliveryId: deliveryAId },
      data: { status: "SENT_TO_STORE" },
    });

    /* A is now SENT_TO_STORE, B is still CREATED — no bucket may be inferred from a default. */
    const { counts } = await listTaxInvoices({ q: storeName, page: 1, perPage: 10 });
    expect(counts).toEqual({ PENDING: 0, CREATED: 1, SENT_TO_STORE: 1, NOT_REQUIRED: 0 });

    const filtered = await listTaxInvoices({ q: storeName, status: "SENT_TO_STORE", page: 1, perPage: 10 });
    expect(filtered.total).toBe(1);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].id).toBe(sent.id);
    expect(filtered.rows[0].status).toBe("SENT_TO_STORE");
  });

  it("represents a SELL_THROUGH-sourced faktur with the report's docNo and store, not the delivery's", async () => {
    const sellThroughInvoiceDate = new Date("2026-03-31T00:00:00.000+07:00");
    const sellThroughDueDate = new Date("2026-04-30T00:00:00.000+07:00");
    await prisma.konsiSellThrough.update({
      where: { id: sellThroughId },
      data: { invoiceDate: sellThroughInvoiceDate, dueDate: sellThroughDueDate, total: 200000 },
    });

    const { rows, total } = await listTaxInvoices({ q: sellThroughStoreName, page: 1, perPage: 10 });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.id).toBe(sellThroughTaxInvoiceId);
    expect(row.sourceKind).toBe("SELL_THROUGH");
    expect(row.docNo).toBe(sellThroughDocNo);
    expect(row.sellThroughId).toBe(sellThroughId);
    expect(row.orderId).toBeNull();
    expect(row.storeId).toBe(sellThroughStoreId);
    expect(row.storeName).toBe(sellThroughStoreName);
    /* The faktur resolver reads these straight off the report once invoicing has stamped them. */
    expect(row.invoiceDate?.getTime()).toBe(sellThroughInvoiceDate.getTime());
    expect(row.dueDate?.getTime()).toBe(sellThroughDueDate.getTime());
    expect(row.total).toBe(200000);
  });

  it("finds a SELL_THROUGH-sourced faktur by the report's own docNo", async () => {
    const { rows, total } = await listTaxInvoices({ q: sellThroughDocNo, page: 1, perPage: 10 });
    expect(total).toBe(1);
    expect(rows[0].id).toBe(sellThroughTaxInvoiceId);
    expect(rows[0].sourceKind).toBe("SELL_THROUGH");
  });

  it("marks every existing DELIVERY row with sourceKind DELIVERY and a real orderId", async () => {
    const { rows } = await listTaxInvoices({ q: storeName, page: 1, perPage: 10 });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.sourceKind).toBe("DELIVERY");
      expect(row.orderId).toBe(orderId);
      expect(row.sellThroughId).toBeNull();
    }
  });
});
