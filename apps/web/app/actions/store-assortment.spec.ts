import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit-only: auth, rbac, prisma and revalidatePath are all mocked, so nothing here touches the
 * shared dev database. This file exists to pin the permission gate (including the admin wildcard
 * shape), the four write guards (dangling itemId, duplicate line, malformed payload, negative /
 * zero targetQty), and that `auth()` throwing never escapes the wrapped try/catch as an opaque
 * error.
 */
const {
  mockAuth,
  mockHasPermission,
  mockRevalidatePath,
  mockItemFindUnique,
  mockLineFindUnique,
  mockLineCreate,
  mockLineUpdateMany,
  mockLineDeleteMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockItemFindUnique: vi.fn(),
  mockLineFindUnique: vi.fn(),
  mockLineCreate: vi.fn(),
  mockLineUpdateMany: vi.fn(),
  mockLineDeleteMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findUnique: mockItemFindUnique },
    storeAssortmentLine: {
      findUnique: mockLineFindUnique,
      create: mockLineCreate,
      updateMany: mockLineUpdateMany,
      deleteMany: mockLineDeleteMany,
    },
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { Prisma } from "@elorae/db";
import { addAssortmentLineAction, updateAssortmentTargetAction, removeAssortmentLineAction } from "./store-assortment";

describe("store assortment actions (unit — prisma mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockRevalidatePath.mockReset();
    mockItemFindUnique.mockReset();
    mockLineFindUnique.mockReset();
    mockLineCreate.mockReset();
    mockLineUpdateMany.mockReset();
    mockLineDeleteMany.mockReset();

    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: [] } });
    mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
    mockItemFindUnique.mockResolvedValue({ id: "item-1" });
    mockLineFindUnique.mockResolvedValue(null);
    mockLineCreate.mockResolvedValue({ id: "line-1" });
    mockLineUpdateMany.mockResolvedValue({ count: 1 });
    mockLineDeleteMany.mockResolvedValue({ count: 1 });
  });

  describe("addAssortmentLineAction", () => {
    it("succeeds and revalidates the store detail page", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockLineCreate).toHaveBeenCalledWith({
        data: { storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5, createdById: "user-1" },
        select: { id: true },
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/s1");
    });

    it("accepts and stores targetQty: null since it is a meaningful value, not an absent one", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: null });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockLineCreate).toHaveBeenCalledWith({
        data: { storeId: "s1", itemId: "item-1", variantSku: "", targetQty: null, createdById: "user-1" },
        select: { id: true },
      });
    });

    it("pins the exact permission code it checks — a mock true for only one code must not pass for a shape no real admin has", async () => {
      await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns FORBIDDEN without stores:manage and never touches prisma", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockItemFindUnique).not.toHaveBeenCalled();
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("returns ERROR rather than throwing when auth() rejects — the wrapped call site, not the writer", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("returns ITEM_NOT_FOUND for a dangling itemId without writing a row", async () => {
      mockItemFindUnique.mockResolvedValue(null);
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "no-such-item", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "ITEM_NOT_FOUND" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("returns DUPLICATE_LINE when the (storeId, itemId, variantSku) already exists, checked up front", async () => {
      mockLineFindUnique.mockResolvedValue({ id: "existing-line" });
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "DUPLICATE_LINE" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("narrows a raw P2002 from a race at create-time onto DUPLICATE_LINE, not an opaque error", async () => {
      mockLineCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "DUPLICATE_LINE" });
    });

    it("maps an unrelated thrown error onto ERROR rather than leaking it", async () => {
      mockLineCreate.mockRejectedValue(new Error("db exploded"));
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("returns INVALID_REQUEST for a malformed payload, never a domain code", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1" } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockItemFindUnique).not.toHaveBeenCalled();
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("refuses a negative targetQty as INVALID_REQUEST without writing a row", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: -1 });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("refuses a zero targetQty as INVALID_REQUEST — meaningless as a target, same as negative", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 0 });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineCreate).not.toHaveBeenCalled();
    });

    it("this feature gates nothing beyond the four guards — never refuses on stock levels or anything document-shaped, and never even queries for any", async () => {
      // The mocked `prisma` above defines only `item` and `storeAssortmentLine` — a future gate
      // reaching for prisma.store, prisma.storeStock, or prisma.inventoryValue would throw on the
      // undefined property, caught by the wrapped try/catch as a generic ERROR rather than failing
      // this test loudly. Pin the exact call counts too, so a gate bolted onto the two models this
      // action already touches (e.g. an extra storeAssortmentLine query) is caught as well.
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "blue", targetQty: 10 });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockItemFindUnique).toHaveBeenCalledTimes(1);
      expect(mockLineFindUnique).toHaveBeenCalledTimes(1);
      expect(mockLineCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateAssortmentTargetAction", () => {
    it("succeeds and revalidates the store detail page", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockLineUpdateMany).toHaveBeenCalledWith({ where: { id: "line-1", storeId: "s1" }, data: { targetQty: 8 } });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/s1");
    });

    it("accepts and stores targetQty: null", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: null });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockLineUpdateMany).toHaveBeenCalledWith({ where: { id: "line-1", storeId: "s1" }, data: { targetQty: null } });
    });

    it("pins the exact permission code it checks", async () => {
      await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns FORBIDDEN without stores:manage and never touches prisma", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockLineUpdateMany).not.toHaveBeenCalled();
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockLineUpdateMany).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when no line matches (id, storeId)", async () => {
      mockLineUpdateMany.mockResolvedValue({ count: 0 });
      const res = await updateAssortmentTargetAction({ id: "no-such", storeId: "s1", targetQty: 8 });
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("returns NOT_FOUND for a real line under a DIFFERENT store, not just for a nonexistent id — the exact scenario (id, storeId) scoping was added for", async () => {
      // Simulate real compound-where (AND) semantics: a row only counts when BOTH id and storeId
      // match. "line-1" genuinely exists, just under "correct-store", not the caller's "s1" — if
      // scoping were ever dropped (or silently OR'd) this would wrongly resolve to ok:true.
      mockLineUpdateMany.mockImplementation(({ where }: { where: { id: string; storeId: string } }) =>
        Promise.resolve({ count: where.id === "line-1" && where.storeId === "correct-store" ? 1 : 0 }),
      );
      const mismatched = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(mismatched).toEqual({ ok: false, code: "NOT_FOUND" });
      const matched = await updateAssortmentTargetAction({ id: "line-1", storeId: "correct-store", targetQty: 8 });
      expect(matched).toEqual({ ok: true, id: "line-1" });
    });

    it("returns INVALID_REQUEST for a malformed payload", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1" } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineUpdateMany).not.toHaveBeenCalled();
    });

    it("refuses a negative targetQty as INVALID_REQUEST", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: -5 });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineUpdateMany).not.toHaveBeenCalled();
    });

    it("refuses a zero targetQty as INVALID_REQUEST", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 0 });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineUpdateMany).not.toHaveBeenCalled();
    });

    it("maps an unrelated thrown error onto ERROR rather than leaking it", async () => {
      mockLineUpdateMany.mockRejectedValue(new Error("db exploded"));
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 8 });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });
  });

  describe("removeAssortmentLineAction", () => {
    it("succeeds and revalidates the store detail page", async () => {
      const res = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(res).toEqual({ ok: true, id: "line-1" });
      expect(mockLineDeleteMany).toHaveBeenCalledWith({ where: { id: "line-1", storeId: "s1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/s1");
    });

    it("pins the exact permission code it checks", async () => {
      await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns FORBIDDEN without stores:manage and never touches prisma", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockLineDeleteMany).not.toHaveBeenCalled();
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockLineDeleteMany).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when no line matches (id, storeId)", async () => {
      mockLineDeleteMany.mockResolvedValue({ count: 0 });
      const res = await removeAssortmentLineAction({ id: "no-such", storeId: "s1" });
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("returns NOT_FOUND for a real line under a DIFFERENT store, not just for a nonexistent id — the exact scenario (id, storeId) scoping was added for", async () => {
      mockLineDeleteMany.mockImplementation(({ where }: { where: { id: string; storeId: string } }) =>
        Promise.resolve({ count: where.id === "line-1" && where.storeId === "correct-store" ? 1 : 0 }),
      );
      const mismatched = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(mismatched).toEqual({ ok: false, code: "NOT_FOUND" });
      const matched = await removeAssortmentLineAction({ id: "line-1", storeId: "correct-store" });
      expect(matched).toEqual({ ok: true, id: "line-1" });
    });

    it("returns INVALID_REQUEST for a malformed payload", async () => {
      const res = await removeAssortmentLineAction({ id: "" } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockLineDeleteMany).not.toHaveBeenCalled();
    });

    it("maps an unrelated thrown error onto ERROR rather than leaking it", async () => {
      mockLineDeleteMany.mockRejectedValue(new Error("db exploded"));
      const res = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });
  });

  /*
   * The wildcard test that makes a "hasPermission true for stores:manage" mock look green even
   * when the guard is broken: a real ADMIN session's permission list literally IS ['*'] (granted
   * in code by isSystem, never from a seeded DB row), and hasPermission treats '*' as satisfying
   * any code. Reproduce that exact shape here so a future edit that checks the wrong permission
   * code still gets caught by the toHaveBeenCalledWith pins above, not masked by this passing.
   */
  describe("admin wildcard shape", () => {
    beforeEach(() => {
      mockHasPermission.mockImplementation((permissions: unknown, _code: string) => Array.isArray(permissions) && permissions.includes("*"));
      mockAuth.mockResolvedValue({ user: { id: "admin-1", permissions: ["*"] } });
    });

    it("addAssortmentLineAction succeeds for a genuine admin session", async () => {
      const res = await addAssortmentLineAction({ storeId: "s1", itemId: "item-1", variantSku: "", targetQty: 5 });
      expect(res.ok).toBe(true);
    });

    it("updateAssortmentTargetAction succeeds for a genuine admin session", async () => {
      const res = await updateAssortmentTargetAction({ id: "line-1", storeId: "s1", targetQty: 5 });
      expect(res.ok).toBe(true);
    });

    it("removeAssortmentLineAction succeeds for a genuine admin session", async () => {
      const res = await removeAssortmentLineAction({ id: "line-1", storeId: "s1" });
      expect(res.ok).toBe(true);
    });
  });
});
