import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { getSalesmenSalesSummary } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getSalesmenSalesSummary (test bed only)", () => {
  const tag = `SMS-${Math.random().toString(36).slice(2, 10)}`;
  let storeId = "";
  let salesmanAId = "";
  let salesmanBId = "";
  const fsoIds: string[] = [];
  const vanSaleIds: string[] = [];

  beforeEach(async () => {
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
    await prisma.vanSale.deleteMany({ where: { id: { in: vanSaleIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: fsoIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [salesmanAId, salesmanBId] } } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    fsoIds.length = 0;
    vanSaleIds.length = 0;
  });

  async function makeOrder(
    seq: number,
    salesmanId: string,
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED",
    orderType: "PUTUS" | "KONSI",
    total: number
  ) {
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `${tag}-${seq}`, storeId, salesmanId, status, orderType, subtotal: total, total },
    });
    fsoIds.push(order.id);
    return order;
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

  it("realised = approved putus + van sale; outstanding = pending putus; konsi/rejected excluded; sorted by realised desc; totals correct", async () => {
    // Salesman A: approved putus 1000, pending putus 500, konsi approved 300 (excluded), rejected putus 200 (excluded), van sale 400
    await makeOrder(1, salesmanAId, "APPROVED", "PUTUS", 1000);
    await makeOrder(2, salesmanAId, "PENDING_APPROVAL", "PUTUS", 500);
    await makeOrder(3, salesmanAId, "APPROVED", "KONSI", 300);
    await makeOrder(4, salesmanAId, "REJECTED", "PUTUS", 200);
    await makeVanSale(1, salesmanAId, 400);

    // Salesman B: approved putus 2000, pending putus 100, van sale 50
    await makeOrder(5, salesmanBId, "APPROVED", "PUTUS", 2000);
    await makeOrder(6, salesmanBId, "PENDING_APPROVAL", "PUTUS", 100);
    await makeVanSale(2, salesmanBId, 50);

    const summary = await getSalesmenSalesSummary();
    const rowA = summary.rows.find((r) => r.salesmanId === salesmanAId);
    const rowB = summary.rows.find((r) => r.salesmanId === salesmanBId);

    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    // 1000 approved putus + 400 van = 1400, 2 realised transactions (1 order + 1 van sale)
    expect(rowA!.realised).toEqual({ count: 2, amount: 1400 });
    expect(rowA!.outstanding).toEqual({ count: 1, amount: 500 });
    // 2000 approved putus + 50 van = 2050
    expect(rowB!.realised).toEqual({ count: 2, amount: 2050 });
    expect(rowB!.outstanding).toEqual({ count: 1, amount: 100 });

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

  it("returns no row for a salesman with no eligible orders/van sales", async () => {
    const summary = await getSalesmenSalesSummary();
    expect(summary.rows.some((r) => r.salesmanId === salesmanAId)).toBe(false);
    expect(summary.rows.some((r) => r.salesmanId === salesmanBId)).toBe(false);
  });
});
