import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getStoreOrderSummary } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getStoreOrderSummary (test bed only)", () => {
  const tag = `SOS-${Math.random().toString(36).slice(2, 10)}`;
  let storeId = "";

  async function makeOrder(seq: number, status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED", orderType: "PUTUS" | "KONSI", total: number) {
    return prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${seq}`,
        storeId,
        salesmanId: (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id,
        status,
        orderType,
        subtotal: total,
        total,
      },
    });
  }

  beforeEach(async () => {
    storeId = "";
    const store = await prisma.store.create({ data: { code: tag, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
  });

  afterEach(async () => {
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId: seededId(storeId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
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

  async function makeDelivery(orderId: string, seq: number, subtotal: number, total: number) {
    return prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${seq}`,
        orderId,
        deliveredAt: new Date(),
        deliveredById: (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal,
        total,
      },
    });
  }

  it("reports delivered total plus the open remainder for a partly delivered approved putus order", async () => {
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000);
    await makeDelivery(order.id, 1, 400, 400);
    const [row] = await getStoreOrderSummary(storeId);
    expect(row.total).toBe(1000);
  });

  it("counts only what was delivered once the remainder is closed", async () => {
    const order = await makeOrder(1, "APPROVED", "PUTUS", 1000);
    await makeDelivery(order.id, 1, 400, 400);
    await prisma.fieldSalesOrder.update({ where: { id: order.id }, data: { deliveryStatus: "CLOSED" } });
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
