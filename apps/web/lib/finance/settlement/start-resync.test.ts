import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    settlement: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(),
  extractApiMessage: (raw: string | undefined, fallback: string) => raw ?? fallback,
}));

vi.mock("./resync-targets", () => ({
  collectResyncTargets: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
import { collectResyncTargets } from "./resync-targets";
import { startSettlementResync } from "./start-resync";

describe("startSettlementResync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND when the settlement is missing, without collecting targets", async () => {
    (prisma.settlement.findUnique as any).mockResolvedValue(null);

    const result = await startSettlementResync("ghost", "u1");

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(collectResyncTargets).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(prisma.settlement.update).not.toHaveBeenCalled();
  });

  it("returns NO_TARGETS without calling the api or stamping the settlement", async () => {
    (prisma.settlement.findUnique as any).mockResolvedValue({ id: "s1" });
    (collectResyncTargets as any).mockResolvedValue([]);

    const result = await startSettlementResync("s1", "u1");

    expect(result).toEqual({ ok: false, code: "NO_TARGETS" });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(prisma.settlement.update).not.toHaveBeenCalled();
  });

  it("returns API_ERROR with the extracted message and leaves the settlement unstamped", async () => {
    (prisma.settlement.findUnique as any).mockResolvedValue({ id: "s1" });
    (collectResyncTargets as any).mockResolvedValue(["SP-111"]);
    (apiFetch as any).mockResolvedValue({ ok: false, status: 500, error: "boom" });

    const result = await startSettlementResync("s1", "u1");

    expect(result).toEqual({ ok: false, code: "API_ERROR", message: "boom" });
    expect(prisma.settlement.update).not.toHaveBeenCalled();
  });

  it("seeds the batch as the given user and stamps it on the settlement, clearing resyncRematchedAt", async () => {
    (prisma.settlement.findUnique as any).mockResolvedValue({ id: "s1" });
    (collectResyncTargets as any).mockResolvedValue(["SP-111", "SP-222"]);
    (apiFetch as any).mockResolvedValue({ ok: true, status: 200, data: { batchId: "batch-xyz", seeded: 2 } });

    const result = await startSettlementResync("s1", "u1");

    expect(collectResyncTargets).toHaveBeenCalledWith("s1");
    expect(apiFetch).toHaveBeenCalledWith("POST", "/jubelio/salesorders/resync", {
      userId: "u1",
      body: { salesorderNos: ["SP-111", "SP-222"] },
      timeoutMs: 15_000,
    });
    expect(prisma.settlement.update).toHaveBeenCalledTimes(1);
    expect(prisma.settlement.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { resyncBatchId: "batch-xyz", resyncSeededAt: expect.any(Date), resyncRematchedAt: null },
    });
    expect(result).toEqual({ ok: true, batchId: "batch-xyz", seeded: 2 });
  });
});
