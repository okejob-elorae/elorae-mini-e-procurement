import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findMany: vi.fn() },
    jubelioCategoryMapping: { findMany: vi.fn() },
    jubelioOutbox: { createMany: vi.fn(), groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import {
  getEligibleItems,
  enqueueBulkMigration,
  getMigrationSummary,
} from "./jubelio-bulk-migration";

describe("jubelio-bulk-migration server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEligibleItems", () => {
    it("throws Unauthorized when session is null", async () => {
      (auth as any).mockResolvedValue(null);
      await expect(getEligibleItems()).rejects.toThrow("Unauthorized");
    });

    it("returns ERP-source FG items without mapping, with category status flag", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([
        {
          id: "i1", sku: "TEST-1", nameId: "T1", nameEn: "Tee 1",
          categoryId: "c1", category: { name: "T-SHIRT" },
          variants: [{ sku: "TEST-1-RED" }, { sku: "TEST-1-BLU" }],
        },
        {
          id: "i2", sku: "TEST-2", nameId: "T2", nameEn: "Tee 2",
          categoryId: null, category: null,
          variants: null,
        },
      ]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([
        { itemCategoryId: "c1" },
      ]);

      const rows = await getEligibleItems();

      expect(prisma.item.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          type: "FINISHED_GOOD",
          source: "ERP",
          jubelioProductMappings: { none: {} },
        }),
      }));
      expect(rows).toEqual([
        expect.objectContaining({
          id: "i1",
          sku: "TEST-1",
          categoryName: "T-SHIRT",
          variantCount: 2,
          hasJubelioCategoryMapping: true,
        }),
        expect.objectContaining({
          id: "i2",
          sku: "TEST-2",
          categoryName: null,
          variantCount: 0,
          hasJubelioCategoryMapping: false,
        }),
      ]);
    });
  });

  describe("enqueueBulkMigration", () => {
    it("throws Unauthorized when session is null", async () => {
      (auth as any).mockResolvedValue(null);
      await expect(enqueueBulkMigration(["i1"])).rejects.toThrow("Unauthorized");
    });

    it("rejects empty array", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      await expect(enqueueBulkMigration([])).rejects.toThrow(/no items/i);
      expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
    });

    it("rejects ids not in the eligible set", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([]);
      await expect(enqueueBulkMigration(["i1", "ghost"])).rejects.toThrow(/not eligible/i);
      expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
    });

    it("creates one outbox row per eligible itemId", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([]);
      (prisma.jubelioOutbox.createMany as any).mockResolvedValue({ count: 2 });

      const result = await enqueueBulkMigration(["i1", "i2"]);

      expect(prisma.jubelioOutbox.createMany).toHaveBeenCalledWith({
        data: [
          { entityType: "product_push", entityId: "i1", payload: {}, enqueuedById: "u1" },
          { entityType: "product_push", entityId: "i2", payload: {}, enqueuedById: "u1" },
        ],
      });
      expect(result).toEqual({ enqueued: 2 });
    });
  });

  describe("getMigrationSummary", () => {
    it("aggregates outbox rows by status for the admin's last 24h", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.jubelioOutbox.groupBy as any).mockResolvedValue([
        { status: "DONE", _count: { _all: 12 } },
        { status: "DEAD", _count: { _all: 1 } },
        { status: "SKIPPED", _count: { _all: 2 } },
        { status: "PENDING", _count: { _all: 3 } },
      ]);

      const summary = await getMigrationSummary();

      expect(prisma.jubelioOutbox.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        by: ["status"],
        where: expect.objectContaining({
          entityType: "product_push",
          enqueuedById: "u1",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }));
      expect(summary).toEqual(expect.objectContaining({
        done: 12,
        dead: 1,
        skipped: 2,
        pending: 3,
        processing: 0,
        total: 18,
      }));
    });
  });
});
