import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar baca antrean pengiriman marketplace. `listFulfillmentQueue` dulu hanya
 * menuntut sudah masuk, jadi salesman/SPG bisa membaca nama pembeli dan nomor
 * pesanan marketplace lewat aksi server ini. Halamannya sendiri dijaga
 * `sales_orders:view` (ROUTE_PERMISSIONS `/backoffice/fulfillment`), jadi
 * aksinya kini menuntut hal yang sama — sebelum kueri berjalan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
}));

vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
  },
}));
vi.mock("@elorae/db/sales-order-fulfillment-writer", () => ({
  markOrderPicked: vi.fn(),
  markOrderPacked: vi.fn(),
  InvalidFulfillmentTransition: class InvalidFulfillmentTransition extends Error {},
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@elorae/db");
const { listFulfillmentQueue } = await import("./fulfillment-queue");

const OPSI = { page: 1, pageSize: 10 } as const;

beforeEach(() => {
  state.sesi = null;
  vi.mocked(prisma.salesOrder.findMany).mockClear();
  vi.mocked(prisma.salesOrder.count).mockClear();
});

describe("listFulfillmentQueue — pagar sales_orders:view", () => {
  it("menolak tanpa sesi", async () => {
    await expect(listFulfillmentQueue(OPSI)).rejects.toThrow(/Unauthorized/);
    expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["salesman", ["pwa:access"]],
    ["SPG", ["pwa:access", "spg_sales:record"]],
    ["kantor tanpa sales_orders:view", ["dashboard:view", "work_orders:view"]],
    ["tanpa izin", []],
  ])("menolak %s sebelum membaca pesanan", async (_peran, izin) => {
    state.sesi = { user: { id: "u1", permissions: izin } };
    await expect(listFulfillmentQueue(OPSI)).rejects.toThrow(/Forbidden/);
    expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
    expect(prisma.salesOrder.count).not.toHaveBeenCalled();
  });

  it.each([[["sales_orders:view"]], [["sales_orders:view", "sales_orders:fulfill"]], [["*"]]])(
    "tetap boleh untuk %j",
    async (izin) => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(listFulfillmentQueue(OPSI)).resolves.toEqual({ rows: [], totalCount: 0 });
      expect(prisma.salesOrder.findMany).toHaveBeenCalledTimes(1);
    },
  );
});
