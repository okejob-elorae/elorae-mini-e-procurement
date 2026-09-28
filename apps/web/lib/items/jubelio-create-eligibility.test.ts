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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.item.findUnique).mockResolvedValue({ type: "FINISHED_GOOD", source: "ERP", categoryId: "cat-1" } as never);
  vi.mocked(prisma.jubelioCategoryMapping.count).mockResolvedValue(1 as never);
  vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.jubelioOutbox.count).mockResolvedValue(0 as never);
});

describe("jubelioCreateEligibility", () => {
  it("is eligible for an unmapped ERP finished good in a mapped category with no push in flight", async () => {
    expect(await jubelioCreateEligibility("i1")).toBe("eligible");
    expect(prisma.jubelioCategoryMapping.count).toHaveBeenCalledWith({ where: { itemCategoryId: "cat-1" } });
    expect(prisma.jubelioOutbox.count).toHaveBeenCalledWith({
      where: { entityType: "product_push", entityId: "i1", status: { in: ["PENDING", "PROCESSING"] } },
    });
  });

  it("refuses a missing item, a non-ERP or non-FG item, a mapped item and a queued push", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce(null as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_found");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ type: "FINISHED_GOOD", source: "JUBELIO_INGEST", categoryId: "cat-1" } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_erp_finished_good");
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ type: "FABRIC", source: "ERP", categoryId: "cat-1" } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("not_erp_finished_good");
    vi.mocked(prisma.jubelioProductMapping.count).mockResolvedValueOnce(1 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_mapped");
    vi.mocked(prisma.jubelioOutbox.count).mockResolvedValueOnce(1 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("already_queued");
  });

  it("refuses an item with no category, or whose category has no Jubelio mapping, before the mapping checks", async () => {
    vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({ type: "FINISHED_GOOD", source: "ERP", categoryId: null } as never);
    expect(await jubelioCreateEligibility("i1")).toBe("category_unmapped");
    expect(prisma.jubelioCategoryMapping.count).not.toHaveBeenCalled();
    vi.mocked(prisma.jubelioCategoryMapping.count).mockResolvedValueOnce(0 as never);
    expect(await jubelioCreateEligibility("i1")).toBe("category_unmapped");
    expect(prisma.jubelioProductMapping.count).not.toHaveBeenCalled();
  });
});
