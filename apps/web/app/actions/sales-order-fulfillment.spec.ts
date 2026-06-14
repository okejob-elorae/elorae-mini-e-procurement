import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioCourier: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@elorae/db/sales-order-fulfillment-writer", () => ({
  markOrderPicked: vi.fn(),
  markOrderPacked: vi.fn(),
  markOrderShipped: vi.fn(),
  InvalidFulfillmentTransition: class InvalidFulfillmentTransition extends Error {
    code = "INVALID_FULFILLMENT_TRANSITION";
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/jubelio-couriers", () => ({ syncJubelioCouriers: vi.fn() }));

import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { syncJubelioCouriers } from "@/app/actions/jubelio-couriers";
import {
  finishPickAction,
  finishPackAction,
  shipOrderAction,
  getCouriersForShipDialog,
} from "./sales-order-fulfillment";

const sessionWithFulfill = {
  user: { id: "u1", permissions: ["sales_orders:fulfill"] },
};
const sessionWithoutFulfill = {
  user: { id: "u1", permissions: ["sales_orders:view"] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("finishPickAction", () => {
  it("happy path: calls markOrderPicked, revalidates, returns ok", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockResolvedValue(undefined);

    const r = await finishPickAction("so1");

    expect(r).toEqual({ ok: true });
    expect(markOrderPicked).toHaveBeenCalledWith(prisma, { orderId: "so1", userId: "u1" });
    expect(revalidatePath).toHaveBeenCalledWith("/backoffice/sales-orders/so1");
  });

  it("returns ok:false on InvalidFulfillmentTransition", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockRejectedValue(
      new InvalidFulfillmentTransition("Order so1 fulfillmentStatus is PICKED"),
    );

    const r = await finishPickAction("so1");

    expect(r).toEqual({ ok: false, reason: expect.stringContaining("PICKED") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns ok:false with forbidden reason when user lacks sales_orders:fulfill", async () => {
    (auth as any).mockResolvedValue(sessionWithoutFulfill);

    const r = await finishPickAction("so1");

    expect(r).toEqual({ ok: false, reason: "forbidden" });
    expect(markOrderPicked).not.toHaveBeenCalled();
  });

  it("throws when no session", async () => {
    (auth as any).mockResolvedValue(null);
    await expect(finishPickAction("so1")).rejects.toThrow(/Unauthorized/);
  });
});

describe("finishPackAction", () => {
  it("calls markOrderPacked", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPacked as any).mockResolvedValue(undefined);

    await finishPackAction("so1");

    expect(markOrderPacked).toHaveBeenCalledWith(prisma, { orderId: "so1", userId: "u1" });
  });
});

describe("shipOrderAction", () => {
  it("passes courierId to markOrderShipped", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderShipped as any).mockResolvedValue(undefined);

    await shipOrderAction("so1", 4);

    expect(markOrderShipped).toHaveBeenCalledWith(prisma, {
      orderId: "so1",
      userId: "u1",
      courierId: 4,
    });
  });
});

describe("getCouriersForShipDialog", () => {
  it("returns cached list when JubelioCourier table is non-empty", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.jubelioCourier.count as any).mockResolvedValue(5);
    (prisma.jubelioCourier.findMany as any).mockResolvedValue([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);

    const list = await getCouriersForShipDialog();

    expect(syncJubelioCouriers).not.toHaveBeenCalled();
    expect(list).toEqual([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);
  });

  it("triggers sync when cache is empty, then returns fresh list", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.jubelioCourier.count as any).mockResolvedValueOnce(0);
    (syncJubelioCouriers as any).mockResolvedValue({ count: 2 });
    (prisma.jubelioCourier.findMany as any).mockResolvedValue([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);

    const list = await getCouriersForShipDialog();

    expect(syncJubelioCouriers).toHaveBeenCalledTimes(1);
    expect(list).toHaveLength(2);
  });
});
