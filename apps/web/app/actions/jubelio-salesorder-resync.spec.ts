import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioSalesOrderResync: { groupBy: vi.fn() },
    settlement: { findUnique: vi.fn() },
    settlementLine: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(),
  extractApiMessage: (raw: string | undefined, fallback: string) => raw ?? fallback,
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import { getResyncSummary, triggerSettlementResyncAction } from "./jubelio-salesorder-resync";

const MANAGE_SESSION = { user: { id: "u1", permissions: ["finance:settlements:manage"] } };
const NO_PERM_SESSION = { user: { id: "u1", permissions: [] } };

describe("jubelio-salesorder-resync server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getResyncSummary", () => {
    it("returns FORBIDDEN when there is no session", async () => {
      (auth as any).mockResolvedValue(null);
      const result = await getResyncSummary("batch-1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(prisma.jubelioSalesOrderResync.groupBy).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when the session lacks the settlements:manage permission", async () => {
      (auth as any).mockResolvedValue(NO_PERM_SESSION);
      const result = await getResyncSummary("batch-1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    });

    it("aggregates resync rows by status for the given batchId", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.jubelioSalesOrderResync.groupBy as any).mockResolvedValue([
        { status: "PENDING", _count: { _all: 3 } },
        { status: "RESOLVING", _count: { _all: 1 } },
        { status: "FETCHING", _count: { _all: 1 } },
        { status: "DONE", _count: { _all: 12 } },
        { status: "NOT_FOUND", _count: { _all: 2 } },
        { status: "DEAD", _count: { _all: 1 } },
        { status: "SKIPPED", _count: { _all: 0 } },
      ]);

      const result = await getResyncSummary("batch-1");

      expect(prisma.jubelioSalesOrderResync.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ["status"],
          where: { batchId: "batch-1" },
        }),
      );
      expect(result).toEqual({
        ok: true,
        pending: 3,
        resolving: 1,
        fetching: 1,
        done: 12,
        notFound: 2,
        dead: 1,
        skipped: 0,
        total: 20,
      });
    });

    it("defaults every status to 0 when the batch has no rows yet", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.jubelioSalesOrderResync.groupBy as any).mockResolvedValue([]);

      const result = await getResyncSummary("batch-empty");

      expect(result).toEqual({
        ok: true,
        pending: 0,
        resolving: 0,
        fetching: 0,
        done: 0,
        notFound: 0,
        dead: 0,
        skipped: 0,
        total: 0,
      });
    });
  });

  describe("triggerSettlementResyncAction", () => {
    it("returns FORBIDDEN when the session lacks the settlements:manage permission", async () => {
      (auth as any).mockResolvedValue(NO_PERM_SESSION);
      const result = await triggerSettlementResyncAction("s1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the settlement doesn't exist", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue(null);

      const result = await triggerSettlementResyncAction("ghost");

      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("returns NO_UNMATCHED_ORDERS when there are no unmatched lines", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue({ marketplace: "SHOPEE" });
      (prisma.settlementLine.findMany as any).mockResolvedValue([]);

      const result = await triggerSettlementResyncAction("s1");

      expect(result).toEqual({ ok: false, code: "NO_UNMATCHED_ORDERS" });
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("returns NO_UNMATCHED_ORDERS when the marketplace has no supported match key", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue({ marketplace: "LAZADA" });
      (prisma.settlementLine.findMany as any).mockResolvedValue([
        { orderNo: "LZ-111" },
        { orderNo: "LZ-222" },
      ]);

      const result = await triggerSettlementResyncAction("s1");

      expect(result).toEqual({ ok: false, code: "NO_UNMATCHED_ORDERS" });
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("resolves unmatched Shopee orderNos to salesorderNos, dedupes, and triggers the api resync", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue({ marketplace: "SHOPEE" });
      (prisma.settlementLine.findMany as any).mockResolvedValue([
        { orderNo: "2606252NSQ63S0" },
        { orderNo: "2606252NSQ63S0" }, // duplicate orderNo across lines — must dedup
        { orderNo: "2607010ABC1234" },
      ]);
      (apiFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { batchId: "batch-xyz", seeded: 2 },
      });

      const result = await triggerSettlementResyncAction("s1");

      expect(prisma.settlementLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { settlementId: "s1", matchStatus: { not: "MATCHED" } },
        }),
      );
      expect(apiFetch).toHaveBeenCalledWith(
        "POST",
        "/jubelio/salesorders/resync",
        expect.objectContaining({
          userId: "u1",
          body: { salesorderNos: ["SP-2606252NSQ63S0", "SP-2607010ABC1234"] },
        }),
      );
      expect(result).toEqual({ ok: true, batchId: "batch-xyz", seeded: 2 });
    });

    it("returns API_ERROR with the extracted message when the api call fails", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue({ marketplace: "SHOPEE" });
      (prisma.settlementLine.findMany as any).mockResolvedValue([{ orderNo: "111" }]);
      (apiFetch as any).mockResolvedValue({ ok: false, status: 500, error: "boom" });

      const result = await triggerSettlementResyncAction("s1");

      expect(result).toEqual({ ok: false, code: "API_ERROR", message: "boom" });
    });
  });
});
