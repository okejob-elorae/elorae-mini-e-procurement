import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
    },
    user: { findMany: vi.fn() },
    jubelioCourier: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@elorae/db";
import { listSalesOrders, getSalesOrderById } from "./queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSalesOrders", () => {
  it("returns empty result when no rows", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    const r = await listSalesOrders({}, { page: 1, pageSize: 10 });

    expect(r).toEqual({ orders: [], totalCount: 0 });
  });

  it("translates filter to Prisma where clause", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders(
      { search: "Alice", channel: "SHOPEE", status: "COMPLETED", dateFrom: new Date("2026-06-01"), dateTo: new Date("2026-06-30") },
      { page: 1, pageSize: 10 },
    );

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBe("SHOPEE");
    expect(args.where.status).toBe("COMPLETED");
    expect(args.where.transactionDate).toEqual({
      gte: new Date("2026-06-01"),
      lte: new Date("2026-06-30"),
    });
    expect(args.where.OR).toEqual([
      { salesorderNo: { contains: "Alice" } },
      { customerName: { contains: "Alice" } },
    ]);
  });

  it("omits where keys when filters are undefined", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders({}, { page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBeUndefined();
    expect(args.where.status).toBeUndefined();
    expect(args.where.transactionDate).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });

  it("applies pagination", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders({}, { page: 3, pageSize: 25 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(args.orderBy).toEqual({ transactionDate: "desc" });
  });

  it("serialises Decimal columns to strings", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([{
      id: "so1",
      salesorderNo: "TT-001",
      channel: "TOKOPEDIA",
      status: "COMPLETED",
      customerName: "Alice",
      grandTotal: { toString: () => "97000" },
      transactionDate: new Date("2026-06-11T10:00:00.000Z"),
    }]);
    (prisma.salesOrder.count as any).mockResolvedValue(1);

    const r = await listSalesOrders({}, { page: 1, pageSize: 10 });

    expect(r.orders[0].grandTotal).toBe("97000");
    expect(r.orders[0].transactionDate).toBeInstanceOf(Date);
  });
});

describe("getSalesOrderById", () => {
  it("returns null when not found", async () => {
    (prisma.salesOrder.findUnique as any).mockResolvedValue(null);
    expect(await getSalesOrderById("missing")).toBeNull();
  });

  it("serialises Decimal columns on the order and every item", async () => {
    (prisma.salesOrder.findUnique as any).mockResolvedValue({
      id: "so1",
      salesorderId: 23043,
      salesorderNo: "TT-001",
      channel: "TOKOPEDIA",
      sourceName: "Shop | Tokopedia",
      status: "COMPLETED",
      channelStatus: "COMPLETED",
      internalStatus: "COMPLETED",
      wmsStatus: "SHIPPED",
      isCanceled: false,
      isPaid: true,
      markedAsComplete: true,
      customerName: "Alice",
      customerPhone: null,
      customerEmail: null,
      shippingProvince: "Jakarta",
      shippingCity: "Jakarta Selatan",
      shippingAddress: { city: "Jakarta Selatan", province: "Jakarta" },
      subTotal: { toString: () => "100000" },
      totalDisc: { toString: () => "3000" },
      totalTax: { toString: () => "0" },
      shippingCost: { toString: () => "2000" },
      grandTotal: { toString: () => "97000" },
      feeBreakdown: { service_fee: "500" },
      paymentMethod: "Bank transfer",
      paymentDate: null,
      transactionDate: new Date("2026-06-11T10:00:00.000Z"),
      createdDateJubelio: null,
      completedDate: new Date("2026-06-11T12:00:00.000Z"),
      cancelDate: null,
      lastModifiedJubelio: null,
      trackingNumber: null,
      courier: null,
      fulfillmentStatus: "PENDING",
      pickedAt: null,
      pickedById: null,
      packedAt: null,
      packedById: null,
      shippedAt: null,
      shippedById: null,
      shipmentJubelioId: null,
      courierId: null,
      items: [
        {
          id: "i1",
          salesorderDetailId: 1,
          jubelioItemId: 100,
          jubelioItemCode: "SKU-A",
          itemId: "erp1",
          productName: "Item A",
          qty: { toString: () => "1.0000" },
          qtyInBase: { toString: () => "1.0000" },
          returnedQty: { toString: () => "0.0000" },
          isCanceledItem: false,
          unitPrice: { toString: () => "100000" },
          pricePaid: { toString: () => "97000" },
          discAmount: { toString: () => "3000" },
          taxAmount: { toString: () => "0" },
          lineTotal: { toString: () => "97000" },
          discMarketplace: { toString: () => "0" },
          weightInGram: { toString: () => "200" },
        },
      ],
    });

    const r = await getSalesOrderById("so1");

    expect(r!.order.grandTotal).toBe("97000");
    expect(r!.order.subTotal).toBe("100000");
    expect(r!.items[0].qty).toBe("1.0000");
    expect(r!.items[0].lineTotal).toBe("97000");
  });

  it("resolves audit user names and courier name", async () => {
    (prisma.salesOrder.findUnique as any).mockResolvedValue({
      id: "so1",
      salesorderId: 23043,
      salesorderNo: "TT-001",
      channel: "TOKOPEDIA",
      sourceName: "Shop | Tokopedia",
      status: "NEW",
      channelStatus: null,
      internalStatus: null,
      wmsStatus: null,
      isCanceled: false,
      isPaid: false,
      markedAsComplete: false,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      shippingProvince: null,
      shippingCity: null,
      shippingAddress: null,
      subTotal: { toString: () => "0" },
      totalDisc: { toString: () => "0" },
      totalTax: { toString: () => "0" },
      shippingCost: { toString: () => "0" },
      grandTotal: { toString: () => "0" },
      feeBreakdown: null,
      paymentMethod: null,
      paymentDate: null,
      transactionDate: new Date(),
      createdDateJubelio: null,
      completedDate: null,
      cancelDate: null,
      lastModifiedJubelio: null,
      trackingNumber: null,
      courier: null,
      fulfillmentStatus: "SHIPPED",
      pickedAt: new Date(),
      pickedById: "u1",
      packedAt: new Date(),
      packedById: "u2",
      shippedAt: new Date(),
      shippedById: "u3",
      shipmentJubelioId: 99,
      courierId: 4,
      items: [],
    });
    (prisma.user.findMany as any).mockResolvedValue([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ]);
    (prisma.jubelioCourier.findUnique as any).mockResolvedValue({ id: 4, name: "SiCepat" });

    const r = await getSalesOrderById("so1");

    expect(r!.order.pickedByName).toBe("Alice");
    expect(r!.order.packedByName).toBe("Bob");
    expect(r!.order.shippedByName).toBe("Carol");
    expect(r!.order.courierName).toBe("SiCepat");
    expect(r!.order.fulfillmentStatus).toBe("SHIPPED");
  });
});

import { getMarketplaceKpi } from "./queries";

describe("getMarketplaceKpi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no orders exist", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(0);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 0 },
      _sum: { grandTotal: null },
    });

    const r = await getMarketplaceKpi();

    expect(r).toEqual({
      pendingFulfillmentCount: 0,
      todaySalesCount: 0,
      todaySalesTotal: "0",
    });
  });

  it("queries pending with status IN [NEW, PROCESSING]", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(7);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 0 },
      _sum: { grandTotal: null },
    });

    await getMarketplaceKpi();

    const countArgs = (prisma.salesOrder.count as any).mock.calls[0][0];
    expect(countArgs.where.status).toEqual({ in: ["NEW", "PROCESSING"] });
  });

  it("queries today's sales between local-day boundaries excluding cancelled/returned", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(0);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 3 },
      _sum: { grandTotal: { toString: () => "250000" } },
    });

    await getMarketplaceKpi();

    const aggArgs = (prisma.salesOrder.aggregate as any).mock.calls[0][0];
    expect(aggArgs.where.status).toEqual({ notIn: ["CANCELLED", "RETURNED"] });
    expect(aggArgs.where.transactionDate.gte).toBeInstanceOf(Date);
    expect(aggArgs.where.transactionDate.lte).toBeInstanceOf(Date);
    const gte = aggArgs.where.transactionDate.gte as Date;
    const lte = aggArgs.where.transactionDate.lte as Date;
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
    expect(gte.getSeconds()).toBe(0);
    expect(lte.getHours()).toBe(23);
    expect(lte.getMinutes()).toBe(59);
    expect(lte.getSeconds()).toBe(59);
    expect(gte.getFullYear()).toBe(lte.getFullYear());
    expect(gte.getMonth()).toBe(lte.getMonth());
    expect(gte.getDate()).toBe(lte.getDate());
  });

  it("serialises grandTotal Decimal to string", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(2);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 3 },
      _sum: { grandTotal: { toString: () => "12345600" } },
    });

    const r = await getMarketplaceKpi();

    expect(r).toEqual({
      pendingFulfillmentCount: 2,
      todaySalesCount: 3,
      todaySalesTotal: "12345600",
    });
  });
});
