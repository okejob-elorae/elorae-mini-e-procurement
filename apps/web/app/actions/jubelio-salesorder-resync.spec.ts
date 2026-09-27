import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioSalesOrderResync: { groupBy: vi.fn() },
    settlement: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

/* The target collection and the api call live in the helper — its own unit test covers them. */
vi.mock("@/lib/finance/settlement/start-resync", () => ({
  startSettlementResync: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { startSettlementResync } from "@/lib/finance/settlement/start-resync";
import {
  getResyncSummary,
  getSettlementResyncState,
  triggerSettlementResyncAction,
} from "./jubelio-salesorder-resync";

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

  describe("getSettlementResyncState", () => {
    it("returns FORBIDDEN when there is no session", async () => {
      (auth as any).mockResolvedValue(null);
      const result = await getSettlementResyncState("s1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when the session lacks the settlements:manage permission", async () => {
      (auth as any).mockResolvedValue(NO_PERM_SESSION);
      const result = await getSettlementResyncState("s1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    });

    it("returns the settlement's batchId, rematchedAtIso and live status", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (prisma.settlement.findUnique as any).mockResolvedValue({
        resyncBatchId: "batch-1",
        resyncRematchedAt: new Date("2026-09-27T04:00:00.000Z"),
        status: "MATCHED",
      });

      const result = await getSettlementResyncState("s1");

      expect(prisma.settlement.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1" },
          select: { resyncBatchId: true, resyncRematchedAt: true, status: true },
        }),
      );
      expect(result).toEqual({
        ok: true,
        batchId: "batch-1",
        rematchedAtIso: "2026-09-27T04:00:00.000Z",
        status: "MATCHED",
      });
    });
  });

  describe("triggerSettlementResyncAction", () => {
    it("returns FORBIDDEN when there is no session", async () => {
      (auth as any).mockResolvedValue(null);
      const result = await triggerSettlementResyncAction("s1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(startSettlementResync).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when the session lacks the settlements:manage permission", async () => {
      (auth as any).mockResolvedValue(NO_PERM_SESSION);
      const result = await triggerSettlementResyncAction("s1");
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(startSettlementResync).not.toHaveBeenCalled();
    });

    it("starts the resync as the session user and passes batchId and seeded through", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (startSettlementResync as any).mockResolvedValue({ ok: true, batchId: "batch-xyz", seeded: 2 });

      const result = await triggerSettlementResyncAction("s1");

      expect(startSettlementResync).toHaveBeenCalledWith("s1", "u1");
      expect(result).toEqual({ ok: true, batchId: "batch-xyz", seeded: 2 });
    });

    it("maps NO_TARGETS to NO_UNMATCHED_ORDERS", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (startSettlementResync as any).mockResolvedValue({ ok: false, code: "NO_TARGETS" });

      const result = await triggerSettlementResyncAction("s1");

      expect(result).toEqual({ ok: false, code: "NO_UNMATCHED_ORDERS" });
    });

    it("passes NOT_FOUND through", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (startSettlementResync as any).mockResolvedValue({ ok: false, code: "NOT_FOUND" });

      const result = await triggerSettlementResyncAction("ghost");

      expect(result).toEqual({ ok: false, code: "NOT_FOUND", message: undefined });
    });

    it("passes API_ERROR through with its message", async () => {
      (auth as any).mockResolvedValue(MANAGE_SESSION);
      (startSettlementResync as any).mockResolvedValue({ ok: false, code: "API_ERROR", message: "boom" });

      const result = await triggerSettlementResyncAction("s1");

      expect(result).toEqual({ ok: false, code: "API_ERROR", message: "boom" });
    });
  });
});
