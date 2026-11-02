import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findUnique: vi.fn() },
    jubelioProductMapping: { count: vi.fn() },
    jubelioCategoryMapping: { count: vi.fn() },
    jubelioOutbox: { count: vi.fn() },
  },
}));

import { prisma } from "@elorae/db";
import { jubelioCreateEligibility } from "./jubelio-create-eligibility";

const fg = { type: "FINISHED_GOOD", source: "ERP", categoryId: "cat-1", jubelioCreateRequestedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.item.findUnique).mockResolvedValue(fg as never);
  vi.mocked(prisma.jubelioCategoryMapping.count).mockResolvedValue(1 as never);
  vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.jubelioOutbox.count).mockResolvedValue(0 as never);
});

describe("jubelioCreateEligibility", () => {
  it("is eligible for an unmapped, unrequested ERP finished good in a mapped category with no push in flight", async () => {
    expect(await jubelioCreateEligibility("i1")).toBe("eligible");
    expect(prisma.jubelioCategoryMapping.count).toHaveBeenCalledWith({ where: { itemCategoryId: "cat-1" } });
    expect(prisma.jubelioOutbox.count).toHaveBeenCalledWith({
      where: { entityType: "product_push", entityId: "i1", status: { in: ["PENDING", "PROCESSING"] } },
    });
  });

  it("refuses a missing item, a non-ERP or non-FG item, a mapped item, a requested item and a queued push", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce(null as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_found");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ ...fg, source: "JUBELIO_INGEST" } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_erp_finished_good");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ ...fg, type: "FABRIC" } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_erp_finished_good");
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValueOnce(1 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_mapped");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ ...fg, jubelioCreateRequestedAt: new Date() } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_requested");
    vi.mocked(prisma.jubelioOutbox.count).mockResolvedValueOnce(1 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_queued");
  });

  it("checks the Jubelio state before the category: a mapped item in an unmapped category is already_mapped", async () => {
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.jubelioCategoryMapping.count).mockResolvedValueOnce(0 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_mapped");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ ...fg, categoryId: null, jubelioCreateRequestedAt: new Date() } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_requested");
  });

  it("refuses an item with no category, or whose category has no Jubelio mapping, once nothing else blocks it", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ ...fg, categoryId: null } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("category_unmapped");
    expect(prisma.jubelioCategoryMapping.count).not.toHaveBeenCalled();
    vi.mocked(prisma.jubelioCategoryMapping.count).mockResolvedValueOnce(0 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("category_unmapped");
  });
});
