import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getStoreOrderSummary } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type DeliveryStatus = "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";

/**
 * One order line of 10 pieces worth the whole order total. `deliveredQty`/`cancelledQty` say
 * what the delivery writers left on it — the summary reads the open quantity from here
 * (`nilaiBelumDinota`), never from the delivery rows.
 */
type LineState = { deliveredQty?: number; cancelledQty?: number };

d("getStoreOrderSummary (test bed only)", () => {
  const tag = `SOS-${Math.random().toString(36).slice(2, 10)}`;
  let storeId = "";
  let uomId = "";
  let itemId = "";

  async function salesmanId() {
    return (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
  }

  async function makeOrder(
    seq: number,
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED",
    orderType: "PUTUS" | "KONSI",
    total: number,
    opts: LineState & { deliveryStatus?: DeliveryStatus } = {},
  ) {
    return prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${seq}`,
        storeId,
        salesmanId: await salesmanId(),
        status,
        orderType,
        subtotal: total,
        total,
        ...(opts.deliveryStatus ? { deliveryStatus: opts.deliveryStatus } : {}),
        lines: {
          create: [
            {
              itemId,
              variantSku: "",
              productName: "T",
              qty: 10,
              unitPrice: total / 10,
              lineTotal: total,
              deliveredQty: opts.deliveredQty ?? 0,
              cancelledQty: opts.cancelledQty ?? 0,
            },
          ],
        },
      },
    });
  }

  beforeEach(async () => {
    storeId = "";
    uomId = "";
    itemId = "";
    const store = await prisma.store.create({ data: { code: tag, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({ data: { sku: `${tag}-ITM`, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100 } })
    ).id;
  });

  afterEach(async () => {
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId: seededId(storeId) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("returns empty for a store with no orders", async () => {
    expect(await getStoreOrderSummary(storeId)).toEqual([]);
  });

  it("excludes REJECTED, orders by createdAt desc, caps at 5, serializes total→number + iso date", async () => {
    // create 6 non-rejected in sequence (createdAt increases) + 1 rejected
    for (let i = 1; i <= 6; i++) await makeOrder(i, i % 2 === 0 ? "APPROVED" : "PENDING_APPROVAL", "PUTUS", 1000 * i);
    await makeOrder(99, "REJECTED", "PUTUS", 999);

    const rows = await getStoreOrderSummary(storeId);
    expect(rows).toHaveLength(5);                       // capped
    expect(rows.some(r => r.orderNo === `${tag}-99`)).toBe(false); // rejected order excluded
    expect(rows[0].orderNo).toBe(`${tag}-6`);           // newest first
    expect(typeof rows[0].total).toBe("number");
    expect(typeof rows[0].createdAtIso).toBe("string");
  });

  it("includes both putus and konsi", async () => {
    await makeOrder(1, "APPROVED", "PUTUS", 1000);
    await makeOrder(2, "APPROVED", "KONSI", 2000);
    const rows = await getStoreOrderSummary(storeId);
    expect(rows.map(r => r.orderType).sort()).toEqual(["KONSI", "PUTUS"]);
  });

  async function makeDelivery(
    orderId: string,
    seq: number,
    subtotal: number,
    total: number,
    extra: { voidedAt?: Date; correctedAt?: Date } = {},
  ) {
    return prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${seq}`,
        orderId,
        deliveredAt: new Date(),
        deliveredById: await salesmanId(),
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal,
        total,
        ...extra,
      },
    });
  }

  it("an approved putus order with nothing delivered reports its own total", async () => {
    await makeOrder(1, "APPROVED", "PUTUS", 1000);
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(1000);
  });

  it("reports the billed delivered total plus the open line value for a partly delivered approved putus order", async () => {
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1001, { deliveredQty: 4, deliveryStatus: "PARTIAL" });
    await makeDelivery(order.id, 1, 400.4, 400);
    const [row] = await getStoreOrderSummary(storeId);
    /* Billed 400 + the 6 open pieces at 100.10 (600.60) — not the raw order total of 1001. */
    expect(row.total).toBeCloseTo(1000.6, 2);
  });

  it("pieces lost in transit lower the nota and never come back as still to deliver (P24)", async () => {
    /* All 10 left the warehouse; 2 were lost, so the nota bills 8 but deliveredQty stays 10. */
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000, { deliveredQty: 10, deliveryStatus: "DELIVERED" });
    await makeDelivery(order.id, 1, 800, 800, { correctedAt: new Date() });
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(800);
  });

  it("pieces refused at the door reopen on the order and count as still to deliver (P24)", async () => {
    /* 10 shipped, 3 refused: the nota bills 7 and the 3 are open again on the order. */
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000, { deliveredQty: 7, deliveryStatus: "PARTIAL" });
    await makeDelivery(order.id, 1, 700, 700, { correctedAt: new Date() });
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(1000);
  });

  it("a voided nota bills nothing and its pieces count as still to deliver (P16/P25)", async () => {
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000, { deliveredQty: 0, deliveryStatus: "PENDING" });
    await makeDelivery(order.id, 1, 0, 0, { voidedAt: new Date() });
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(1000);
  });

  it("counts only what was delivered once the remainder is closed", async () => {
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000, { deliveredQty: 4, cancelledQty: 6, deliveryStatus: "CLOSED" });
    await makeDelivery(order.id, 1, 400, 400);
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(400);
  });

  it("keeps the order total for konsi and unapproved orders", async () => {
    await makeOrder(1, "APPROVED", "KONSI", 2000);
    await makeOrder(2, "PENDING_APPROVAL", "PUTUS", 3000);
    const rows = await getStoreOrderSummary(storeId);
    expect(rows.map((r) => r.total).sort()).toEqual([2000, 3000]);
  });
});
