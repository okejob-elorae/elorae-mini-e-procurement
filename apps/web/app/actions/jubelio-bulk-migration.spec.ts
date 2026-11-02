import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findMany: vi.fn(), count: vi.fn() },
    jubelioCategoryMapping: { findMany: vi.fn() },
    jubelioOutbox: { create: vi.fn(), createMany: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/jubelio/harga/pengajuan", () => ({
  ajukanKeJubelio: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { ajukanKeJubelio } from "@/lib/jubelio/harga/pengajuan";
import {
  getEligibleItems,
  requestBulkMigration,
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

    it("returns ERP-source FG items without mapping, with category status and request flags", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([
        {
          id: "i1", sku: "TEST-1", nameId: "T1", nameEn: "Tee 1",
          categoryId: "c1", category: { name: "T-SHIRT" },
          variants: [{ sku: "TEST-1-RED" }, { sku: "TEST-1-BLU" }],
          jubelioCreateRequestedAt: new Date("2026-11-02T03:00:00.000Z"),
        },
        {
          id: "i2", sku: "TEST-2", nameId: "T2", nameEn: "Tee 2",
          categoryId: null, category: null,
          variants: null,
          jubelioCreateRequestedAt: null,
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
          jubelioCreateRequestedAt: "2026-11-02T03:00:00.000Z",
        }),
        expect.objectContaining({
          id: "i2",
          sku: "TEST-2",
          categoryName: null,
          variantCount: 0,
          hasJubelioCategoryMapping: false,
          jubelioCreateRequestedAt: null,
        }),
      ]);
    });
  });

  /*
   * Owner decision 2026-11-02: the bulk migration only REQUESTS the products. Nothing is created in
   * Jubelio — and no outbox row is written — until each price is confirmed on Konfirmasi harga.
   */
  describe("requestBulkMigration", () => {
    it("returns TANPA_AKSES (not a thrown Error) when session is null", async () => {
      (auth as any).mockResolvedValue(null);
      await expect(requestBulkMigration(["i1"])).resolves.toEqual({ ok: false, code: "TANPA_AKSES" });
    });

    it("returns TANPA_AKSES when the user lacks settings_security:manage", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["settings_security:view"] } });
      const r = await requestBulkMigration(["i1"]);
      expect(r).toMatchObject({ ok: false, code: "TANPA_AKSES" });
      expect(ajukanKeJubelio).not.toHaveBeenCalled();
    });

    it("rejects an empty or malformed selection", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      expect(await requestBulkMigration([])).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(await requestBulkMigration([42 as unknown as string])).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(ajukanKeJubelio).not.toHaveBeenCalled();
    });

    it("rejects ids not in the eligible set", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }]);
      const r = await requestBulkMigration(["i1", "ghost"]);
      expect(r).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(r.ok ? "" : r.rincian).toMatch(/not eligible/i);
      expect(ajukanKeJubelio).not.toHaveBeenCalled();
    });

    it("requests the eligible items in the actor's name and creates no outbox rows", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
      (ajukanKeJubelio as any).mockResolvedValue([
        { itemId: "i1", hasil: "DIAJUKAN" },
        { itemId: "i2", hasil: "DIAJUKAN" },
      ]);

      const result = await requestBulkMigration(["i1", "i2"]);

      expect(ajukanKeJubelio).toHaveBeenCalledWith(["i1", "i2"], "u1");
      expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
      expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: { requested: 2, skipped: 0 } });
    });

    it("reports already-requested or in-flight items as skipped", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }, { id: "i2" }, { id: "i3" }]);
      (ajukanKeJubelio as any).mockResolvedValue([
        { itemId: "i1", hasil: "SUDAH_DIAJUKAN" },
        { itemId: "i2", hasil: "DIAJUKAN" },
        { itemId: "i3", hasil: "SEDANG_DIKIRIM" },
      ]);

      const result = await requestBulkMigration(["i1", "i2", "i3"]);

      expect(result).toEqual({ ok: true, data: { requested: 1, skipped: 2 } });
    });
  });

  describe("getMigrationSummary", () => {
    it("aggregates outbox rows by status for the admin's last 24h and counts requests awaiting price confirmation", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.jubelioOutbox.groupBy as any).mockResolvedValue([
        { status: "DONE", _count: { _all: 12 } },
        { status: "DEAD", _count: { _all: 1 } },
        { status: "SKIPPED", _count: { _all: 2 } },
        { status: "PENDING", _count: { _all: 3 } },
      ]);
      (prisma.item.count as any).mockResolvedValue(4);

      const summary = await getMigrationSummary();

      expect(prisma.jubelioOutbox.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        by: ["status"],
        where: expect.objectContaining({
          entityType: "product_push",
          enqueuedById: "u1",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }));
      expect(prisma.item.count).toHaveBeenCalledWith({
        where: {
          type: "FINISHED_GOOD",
          source: "ERP",
          jubelioCreateRequestedAt: { not: null },
          jubelioProductMappings: { none: {} },
        },
      });
      expect(summary).toEqual(expect.objectContaining({
        done: 12,
        dead: 1,
        skipped: 2,
        pending: 3,
        processing: 0,
        total: 18,
        awaitingPriceConfirmation: 4,
      }));
    });
  });
});
