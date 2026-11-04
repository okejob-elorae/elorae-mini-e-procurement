import { describe, it, expect, beforeEach, vi } from "vitest";

/* Unit saja — prisma, auth, dan rbac ditirukan. Memasak validasi dan kolom promo BONUS. */
const { mockAuth, mockCreate, mockItemCount } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockItemCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: () => true };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({
  prisma: { promo: { create: mockCreate }, item: { count: mockItemCount } },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

import { createPromoAction, type PromoFormInput } from "./promos";

const dasar: PromoFormInput = {
  name: "Beli 6 gratis 1",
  type: "BONUS",
  level: "LINE",
  value: null,
  minQty: null,
  minOrderSubtotal: null,
  minOrderQty: null,
  allStores: true,
  startsAt: null,
  endsAt: null,
  priority: 0,
  isActive: true,
  itemIds: ["i1"],
  storeIds: [],
  tiers: [],
  bonusBuyQty: 6,
  bonusFreeQty: 1,
  bonusItemId: null,
};

describe("createPromoAction — BONUS", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["promos:manage"] } });
    mockCreate.mockReset().mockResolvedValue({ id: "p1" });
    mockItemCount.mockReset().mockResolvedValue(1);
  });

  it("saves the bonus columns with no value, no minQty and no tiers", async () => {
    const r = await createPromoAction({ ...dasar, value: 99, minQty: 3, tiers: [{ minQty: 1, unitPrice: 1 }] });
    expect(r).toEqual({ ok: true, id: "p1" });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "BONUS", level: "LINE", value: null, minQty: null, bonusBuyQty: 6, bonusFreeQty: 1, bonusItemId: null });
    expect(data.tiers).toEqual({ create: [] });
  });

  it.each([
    ["missing buy qty", { bonusBuyQty: null }],
    ["zero free qty", { bonusFreeQty: 0 }],
    ["fractional buy qty", { bonusBuyQty: 1.5 }],
    ["ORDER level", { level: "ORDER" as const }],
    ["no items", { itemIds: [] }],
    ["blank gift id", { bonusItemId: " " }],
  ])("refuses %s", async (_label, patch) => {
    const r = await createPromoAction({ ...dasar, ...patch });
    expect(r).toEqual({ ok: false, reason: "INVALID" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a gift item that does not exist", async () => {
    mockItemCount.mockResolvedValue(0);
    const r = await createPromoAction({ ...dasar, bonusItemId: "hilang" });
    expect(r).toEqual({ ok: false, reason: "INVALID" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("a non-BONUS promo never keeps bonus columns", async () => {
    await createPromoAction({ ...dasar, type: "PERCENT", value: 10 });
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({ value: 10, bonusBuyQty: null, bonusFreeQty: null, bonusItemId: null });
  });
});
