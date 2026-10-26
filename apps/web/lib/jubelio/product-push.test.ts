import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findUnique: vi.fn() },
    jubelioProductMapping: { count: vi.fn() },
    jubelioOutbox: { create: vi.fn() },
  },
}));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/items/jubelio-push-diff", () => ({ hasPushableChange: vi.fn().mockReturnValue(true) }));

import { prisma } from "@elorae/db";
import { enqueueProductPushOnImageChange, enqueueProductPushOnUpdate } from "./product-push";
import type { PushableSnapshot } from "@/lib/items/jubelio-push-diff";

const snapshot = {} as PushableSnapshot;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.jubelioOutbox.create).mockResolvedValue({ id: "row-1" } as never);
});

describe.each([
  ["enqueueProductPushOnUpdate", () => enqueueProductPushOnUpdate("i1", snapshot, snapshot, "u1")],
  ["enqueueProductPushOnImageChange", () => enqueueProductPushOnImageChange("i1", "u1")],
])("%s", (_name, run) => {
  it("does not create an unmapped ERP finished good in Jubelio as a side effect of an edit", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValue({ id: "i1", type: "FINISHED_GOOD" } as never);
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValue(0 as never);
    await run();
    expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
  });

  it("queues a product push for a finished good Jubelio already knows", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValue({ id: "i1", type: "FINISHED_GOOD" } as never);
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValue(1 as never);
    await run();
    expect(prisma.jubelioOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: "product_push", entityId: "i1", enqueuedById: "u1" }) }),
    );
  });

  it("ignores items that are not finished goods", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValue({ id: "i1", type: "FABRIC" } as never);
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValue(1 as never);
    await run();
    expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
  });
});
