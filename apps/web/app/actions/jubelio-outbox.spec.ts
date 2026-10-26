import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  isJubelioStockPushEnabled: vi.fn(),
  JUBELIO_STOCK_PUSH_ENABLED_KEY: "jubelio.stockPushEnabled",
  prisma: {
    jubelioOutbox: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getJubelioOutboxRows } from "./jubelio-outbox";

describe("getJubelioOutboxRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } } as never);
    vi.mocked(prisma.jubelioOutbox.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.jubelioOutbox.count).mockResolvedValue(0 as never);
  });

  function lastWhere(): Record<string, unknown> {
    const call = vi.mocked(prisma.jubelioOutbox.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    return call.where;
  }

  it("returns nothing and queries nothing for a non-admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", permissions: ["items:view"] } } as never);
    const res = await getJubelioOutboxRows({ q: "abc" });
    expect(res).toEqual({ rows: [], total: 0 });
    expect(prisma.jubelioOutbox.findMany).not.toHaveBeenCalled();
  });

  it("ORs the search term across id, entityId, entityType and lastError", async () => {
    await getJubelioOutboxRows({ q: "  boom  " });
    expect(lastWhere()).toEqual({
      OR: [
        { id: { contains: "boom" } },
        { entityId: { contains: "boom" } },
        { entityType: { contains: "boom" } },
        { lastError: { contains: "boom" } },
      ],
    });
  });

  it("ANDs the status filter with the search OR rather than folding them together", async () => {
    await getJubelioOutboxRows({ q: "boom", status: ["DEAD", "SKIPPED"], entityType: "product_push" });
    const where = lastWhere();
    expect(where.status).toEqual({ in: ["DEAD", "SKIPPED"] });
    expect(where.entityType).toBe("product_push");
    expect(where.OR).toHaveLength(4);
    expect(vi.mocked(prisma.jubelioOutbox.count).mock.calls[0][0]).toEqual({ where });
  });

  it("applies no OR for a blank search and a single status as an equality", async () => {
    await getJubelioOutboxRows({ q: "   ", status: "PENDING" });
    expect(lastWhere()).toEqual({ status: "PENDING" });
  });

  it("caps an oversized search term at 200 characters", async () => {
    await getJubelioOutboxRows({ q: "x".repeat(500) });
    const or = lastWhere().OR as Array<{ id: { contains: string } }>;
    expect(or[0].id.contains).toHaveLength(200);
  });
});
