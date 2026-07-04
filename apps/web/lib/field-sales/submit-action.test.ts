import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { submitFieldSalesOrder } from "@/app/pwa/stores/[id]/catalog/actions";

d("submitFieldSalesOrder (test bed only)", () => {
  const sku = `TEST-FSA-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: salesmanId, email: "salesman@elorae.com" } });
  });

  afterEach(async () => {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  const line = () => ({ itemId, variantSku: "", productName: "T", qty: 6, unitPrice: 35000 });

  it("happy path: creates order and returns orderNo", async () => {
    const result = await submitFieldSalesOrder({ storeId, lines: [line()] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.orderNo).toBeTruthy();

    const order = await prisma.fieldSalesOrder.findUnique({ where: { orderNo: result.orderNo }, include: { lines: true } });
    expect(order).not.toBeNull();
    expect(order!.storeId).toBe(storeId);
    expect(order!.lines).toHaveLength(1);
  });

  it("qty below minimum returns MIN_QTY", async () => {
    const result = await submitFieldSalesOrder({ storeId, lines: [{ ...line(), qty: 3 }] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.code).toBe("MIN_QTY");
    if (result.code !== "MIN_QTY") throw new Error("expected MIN_QTY code");
    expect(result.violations.some((v) => v.itemId === itemId)).toBe(true);
  });

  it("no active visit returns NO_ACTIVE_VISIT", async () => {
    await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
    const result = await submitFieldSalesOrder({ storeId, lines: [line()] });
    expect(result).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("empty lines returns EMPTY", async () => {
    const result = await submitFieldSalesOrder({ storeId, lines: [] });
    expect(result).toEqual({ ok: false, code: "EMPTY" });
  });
});
