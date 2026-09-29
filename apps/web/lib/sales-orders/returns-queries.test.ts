import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    salesReturn: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@elorae/db";
import { getSalesOrderReturns } from "./returns-queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSalesOrderReturns", () => {
  it("queries salesReturn scoped to the order, newest received first", async () => {
    (prisma.salesReturn.findMany as any).mockResolvedValue([]);

    await getSalesOrderReturns("so1");

    const args = (prisma.salesReturn.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ salesOrderId: "so1" });
    expect(args.orderBy).toEqual({ receivedAt: "desc" });
  });

  it("serialises item Decimal qty to a string and passes decision through", async () => {
    (prisma.salesReturn.findMany as any).mockResolvedValue([
      {
        id: "ret1",
        jubelioReturnNo: "RET-001",
        jubelioReturnId: 42,
        status: "PARTIAL",
        receivedAt: new Date("2026-06-11T10:00:00.000Z"),
        items: [
          {
            salesOrderDetailId: 1,
            qty: { toString: () => "2.00" },
            decision: "ACCEPTED",
          },
          {
            salesOrderDetailId: null,
            qty: { toString: () => "1.00" },
            decision: "PENDING",
          },
        ],
      },
    ]);

    const rows = await getSalesOrderReturns("so1");

    expect(rows).toEqual([
      {
        id: "ret1",
        jubelioReturnNo: "RET-001",
        jubelioReturnId: 42,
        status: "PARTIAL",
        receivedAt: new Date("2026-06-11T10:00:00.000Z"),
        items: [
          { salesOrderDetailId: 1, qty: "2.00", decision: "ACCEPTED" },
          { salesOrderDetailId: null, qty: "1.00", decision: "PENDING" },
        ],
      },
    ]);
  });

  it("returns an empty array when the order has no returns", async () => {
    (prisma.salesReturn.findMany as any).mockResolvedValue([]);

    const rows = await getSalesOrderReturns("so1");

    expect(rows).toEqual([]);
  });
});
