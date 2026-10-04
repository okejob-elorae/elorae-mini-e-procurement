import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@elorae/db/sales-order-fulfillment-writer", () => ({
  markOrderPicked: vi.fn(),
  markOrderPacked: vi.fn(),
  InvalidFulfillmentTransition: class InvalidFulfillmentTransition extends Error {
    code = "INVALID_FULFILLMENT_TRANSITION";
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { cariTeks } from "@/lib/db/cari-teks";
import { revalidatePath } from "next/cache";
import {
  listFulfillmentQueue,
  batchFinishPickAction,
  batchFinishPackAction,
} from "./fulfillment-queue";

const sessionWithFulfill = {
  user: { id: "u1", permissions: ["sales_orders:view", "sales_orders:fulfill"] },
};
const sessionViewOnly = {
  user: { id: "u1", permissions: ["sales_orders:view"] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listFulfillmentQueue", () => {
  it("defaults to fulfillmentStatus=PENDING when not provided", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({ page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.fulfillmentStatus).toBe("PENDING");
  });

  it("ALL skips the fulfillmentStatus filter", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({ fulfillmentStatus: "ALL", page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.fulfillmentStatus).toBeUndefined();
  });

  it("applies channel + date + search filters", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({
      fulfillmentStatus: "PENDING",
      channel: "SHOPEE",
      search: "Alice",
      dateFrom: new Date("2026-06-01T00:00:00Z"),
      dateTo: new Date("2026-06-30T23:59:59Z"),
      page: 1,
      pageSize: 10,
    });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBe("SHOPEE");
    expect(args.where.transactionDate).toEqual({
      gte: new Date("2026-06-01T00:00:00Z"),
      lte: new Date("2026-06-30T23:59:59Z"),
    });
    expect(args.where.OR).toEqual([
      { salesorderNo: cariTeks("Alice") },
      { customerName: cariTeks("Alice") },
    ]);
  });

  // Pencarian harus abai huruf di kedua dialek: di PostgreSQL lewat opsi Prisma,
  // di MariaDB lewat collation *_ci — dan klien MariaDB menolak opsi itu.
  it.each([
    ["postgresql://u:p@127.0.0.1:55432/elorae", true],
    ["mysql://u:p@127.0.0.1:3306/elorae", false],
  ])("search filter mengikuti dialek DATABASE_URL (%s)", async (url, pakaiMode) => {
    vi.stubEnv("DATABASE_URL", url);
    try {
      (auth as any).mockResolvedValue(sessionWithFulfill);
      (prisma.salesOrder.findMany as any).mockResolvedValue([]);
      (prisma.salesOrder.count as any).mockResolvedValue(0);

      await listFulfillmentQueue({ search: "  Alice ", page: 1, pageSize: 10 });

      const or = (prisma.salesOrder.findMany as any).mock.calls[0][0].where.OR;
      expect(or).toHaveLength(2);
      for (const syarat of or) {
        const filter = Object.values(syarat)[0] as Record<string, unknown>;
        expect(filter.contains).toBe("Alice");
        expect("mode" in filter).toBe(pakaiMode);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("translates sort field + dir to orderBy", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({
      sortField: "salesorderNo",
      sortDir: "asc",
      page: 2,
      pageSize: 25,
    });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.orderBy).toEqual({ salesorderNo: "asc" });
    expect(args.skip).toBe(25);
    expect(args.take).toBe(25);
  });
});

describe("batchFinishPickAction", () => {
  it("processes all PENDING orders, returns processed count", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockResolvedValue(undefined);

    const r = await batchFinishPickAction(["so1", "so2", "so3"]);

    expect(r).toEqual({ ok: true, processed: 3, skipped: 0 });
    expect(markOrderPicked).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/backoffice/fulfillment");
  });

  it("buckets InvalidFulfillmentTransition as skipped without throwing", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new InvalidFulfillmentTransition("Order so2 already PICKED"))
      .mockResolvedValueOnce(undefined);

    const r = await batchFinishPickAction(["so1", "so2", "so3"]);

    expect(r).toEqual({ ok: true, processed: 2, skipped: 1 });
  });

  it("returns forbidden when user lacks sales_orders:fulfill", async () => {
    (auth as any).mockResolvedValue(sessionViewOnly);

    const r = await batchFinishPickAction(["so1"]);

    expect(r).toEqual({ ok: false, reason: "forbidden" });
    expect(markOrderPicked).not.toHaveBeenCalled();
  });

  it("propagates non-transition errors (DB down etc.)", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockRejectedValueOnce(new Error("connection refused"));

    await expect(batchFinishPickAction(["so1"])).rejects.toThrow("connection refused");
  });
});

describe("batchFinishPackAction", () => {
  it("calls markOrderPacked for each order", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPacked as any).mockResolvedValue(undefined);

    const r = await batchFinishPackAction(["so1", "so2"]);

    expect(r).toEqual({ ok: true, processed: 2, skipped: 0 });
    expect(markOrderPacked).toHaveBeenCalledTimes(2);
  });

  it("returns forbidden when user lacks fulfill permission", async () => {
    (auth as any).mockResolvedValue(sessionViewOnly);

    const r = await batchFinishPackAction(["so1"]);

    expect(r).toEqual({ ok: false, reason: "forbidden" });
  });
});
