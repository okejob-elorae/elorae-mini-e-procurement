import { describe, it, expect } from "vitest";
import { serializeListItem } from "./queries";
import { Prisma } from "@elorae/db";

describe("serializeListItem", () => {
  it("flattens relations + coerces Decimal total to number", () => {
    const row = {
      id: "o1",
      orderNo: "PUTUS/2026/0001",
      status: "PENDING_APPROVAL" as const,
      total: new Prisma.Decimal("210000.00"),
      createdAt: new Date("2026-07-04T00:00:00Z"),
      store: { name: "Toko A" },
      salesman: { name: "Budi" },
    };
    expect(serializeListItem(row)).toEqual({
      id: "o1",
      orderNo: "PUTUS/2026/0001",
      storeName: "Toko A",
      salesmanName: "Budi",
      status: "PENDING_APPROVAL",
      total: 210000,
      createdAt: new Date("2026-07-04T00:00:00Z"),
    });
  });
  it("falls back when salesman name is null", () => {
    const row = {
      id: "o2", orderNo: "PUTUS/2026/0002", status: "APPROVED" as const,
      total: new Prisma.Decimal("0"), createdAt: new Date("2026-07-04T00:00:00Z"),
      store: { name: "Toko B" }, salesman: { name: null },
    };
    expect(serializeListItem(row).salesmanName).toBe("—");
  });
});
