import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";

/*
 * `field-sales-orders.spec.ts` mocks the whole `@/lib/field-sales/writer` module, which strips
 * `approveKonsiOrderInTx` — the real core `createKonsiPushOrder` calls internally — so a real push
 * cannot be exercised there. This file mocks only auth and drives the real writer against the
 * shared dev test bed through `createSellThroughFixtures()`, the same shape as
 * `konsi-push-writer.test.ts` and `konsi-sell-through.spec.ts`.
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* Stubbed so no writer fan-out can queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { createKonsiPushOrderAction } from "./field-sales-orders";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Every good-push case drives a real serializable writer end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("createKonsiPushOrderAction (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state } = fx;

  beforeEach(async () => {
    await fx.beforeEach();
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: state.userId, permissions: ["field_sales_orders:approve"] } });
  });
  afterEach(fx.afterEach);

  const push = (overrides: Record<string, unknown> = {}) =>
    createKonsiPushOrderAction({
      storeId: state.storeId,
      salesmanId: state.salesmanId,
      lines: [{ itemId: state.itemId, variantSku: "", qty: 3 }],
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    });

  it("returns FORBIDDEN without the approve permission and never calls the writer", async () => {
    mockAuth.mockResolvedValue({ user: { id: state.userId, permissions: [] } });
    const res = await push();
    expect(res).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);
  });

  it("returns INVALID_REQUEST for a missing storeId", async () => {
    const res = await push({ storeId: undefined });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("returns INVALID_REQUEST for a non-array lines", async () => {
    const res = await push({ lines: "not-an-array" });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("returns INVALID_REQUEST for a non-integer qty", async () => {
    const res = await push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 1.5 }] });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("returns INVALID_REQUEST for a qty above the 32-bit Int ceiling", async () => {
    const res = await push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 2147483648 }] });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("returns INVALID_REQUEST for an idempotencyKey that is not UUID-shaped", async () => {
    const res = await push({ idempotencyKey: "not-a-uuid" });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("returns INVALID_REQUEST for a note longer than 2000 characters", async () => {
    const res = await push({ note: "x".repeat(2001) });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);
  });

  it("creates an ADMIN-origin order on a good push", async () => {
    const res = await push();
    expect(res).toMatchObject({ ok: true, orderNo: expect.any(String) });
    if (!res.ok) throw new Error("expected ok");
    state.orderIds.push(res.orderId);

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(res.orderId) } });
    expect(order).toMatchObject({ orderNo: res.orderNo, orderType: "KONSI", origin: "ADMIN", status: "APPROVED" });
  }, SLOW);

  it("returns INSUFFICIENT_STOCK with shortLines for a short line", async () => {
    const inv = await prisma.inventoryValue.findFirstOrThrow({
      where: { itemId: seededId(state.itemId), OR: [{ variantSku: null }, { variantSku: "" }] },
    });
    const tooMany = Number(inv.qtyOnHand) - Number(inv.reservedQty) + 1;
    const res = await push({ lines: [{ itemId: state.itemId, variantSku: "", qty: tooMany }] });
    expect(res).toEqual({
      ok: false,
      reason: "INSUFFICIENT_STOCK",
      shortLines: [expect.objectContaining({ itemId: state.itemId })],
    });
  }, SLOW);

  it("passes a KonsiPushError's code and detail through", async () => {
    const res = await push({
      lines: [
        { itemId: state.itemId, variantSku: "", qty: 1 },
        { itemId: state.itemId, variantSku: "", qty: 2 },
      ],
    });
    expect(res).toEqual({ ok: false, reason: "DUPLICATE", detail: `${state.itemId}::` });
  }, SLOW);
});
