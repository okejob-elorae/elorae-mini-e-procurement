import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit-only: auth, rbac, the visit lookup, the four writers and prisma are all mocked, so
 * nothing here touches the shared dev database. This file exists to pin the permission gate,
 * the dual-shape saveCountsAction guard, and the error-code mapping the actions add on top of
 * the writers from Task 3.
 */
const {
  mockAuth,
  mockHasPermission,
  mockActiveVisit,
  mockCreate,
  mockSave,
  mockApprove,
  mockCancel,
  mockRevalidatePath,
  mockFindUser,
  mockFindStocktakeFirst,
  mockFindStocktakeUnique,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockActiveVisit: vi.fn(),
  mockCreate: vi.fn(),
  mockSave: vi.fn(),
  mockApprove: vi.fn(),
  mockCancel: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockFindUser: vi.fn(),
  mockFindStocktakeFirst: vi.fn(),
  mockFindStocktakeUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: mockActiveVisit }));
vi.mock("@/lib/stores/stocktake/writer", () => ({
  createStoreStocktake: mockCreate,
  saveStocktakeCounts: mockSave,
  approveStoreStocktake: mockApprove,
  cancelStoreStocktake: mockCancel,
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: mockFindUser },
    storeStocktake: { findFirst: mockFindStocktakeFirst, findUnique: mockFindStocktakeUnique },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { StoreStocktakeError } from "@/lib/stores/stocktake/errors";
import { createAction, saveCountsAction, approveAction, cancelAction } from "./store-stocktakes";

describe("store stocktake actions (unit — writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockActiveVisit.mockReset();
    mockCreate.mockReset();
    mockSave.mockReset();
    mockApprove.mockReset();
    mockCancel.mockReset();
    mockRevalidatePath.mockReset();
    mockFindUser.mockReset();
    mockFindStocktakeFirst.mockReset();
    mockFindStocktakeUnique.mockReset();

    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockCreate.mockResolvedValue({ id: "st-1", docNo: "STOCKTAKE/0001" });
    mockSave.mockResolvedValue({ ok: true, status: "DRAFT" });
    mockApprove.mockResolvedValue({ ok: true });
    mockCancel.mockResolvedValue({ ok: true });
    mockActiveVisit.mockResolvedValue({ storeId: "s1" });
    mockFindUser.mockResolvedValue({ assignedStoreId: "s1" });
    mockFindStocktakeFirst.mockResolvedValue(null);
    mockFindStocktakeUnique.mockResolvedValue({ storeId: "s1" });
  });

  describe("createAction", () => {
    /*
     * The primary path: an admin opens a count at a store with NO SPG assigned at all. This is
     * the only path likely to be exercised in production for most stores, so it must succeed
     * without any SPG machinery ever coming into play.
     */
    it("succeeds at a store with NO SPG assigned — the primary path", async () => {
      mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res.ok).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith({ storeId: "s1", createdById: "user-1", countedAt: new Date("2026-08-25") });
    });

    /*
     * A hasPermission mock returning true for ANY code would stay green even if the guard
     * checked a different permission entirely — pin the exact code being asked for.
     */
    it("pins the permission it checks", async () => {
      mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns FORBIDDEN without stores:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a missing storeId without calling the writer", async () => {
      const res = await createAction({ storeId: "", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for an unparseable countedAt without calling the writer", async () => {
      const res = await createAction({ storeId: "s1", countedAt: "not-a-date" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("refuses a second stocktake while one is open, naming the open one", async () => {
      mockCreate.mockRejectedValue(new StoreStocktakeError("ALREADY_OPEN"));
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "ALREADY_OPEN" });
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("maps an unknown throw from the writer onto ERROR rather than leaking it", async () => {
      mockCreate.mockRejectedValue(new Error("db exploded"));
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("revalidates the list, the new document's detail route, and the store detail route on success", async () => {
      const res = await createAction({ storeId: "s1", countedAt: "2026-08-25" });
      expect(res).toEqual({ ok: true, id: "st-1" });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes/st-1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/s1");
    });
  });

  describe("saveCountsAction", () => {
    it("returns INVALID_REQUEST for a malformed payload, not a domain code", async () => {
      const res = await saveCountsAction({ stocktakeId: "", lines: "nope" } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST when both stocktakeId and storeId are supplied", async () => {
      const res = await saveCountsAction({ stocktakeId: "st1", storeId: "s1", lines: [] } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST when neither stocktakeId nor storeId is supplied", async () => {
      const res = await saveCountsAction({ lines: [] } as never);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("returns FORBIDDEN when the user holds neither stores:manage nor spg_sales:record", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockSave).not.toHaveBeenCalled();
    });

    describe("admin path (stocktakeId, stores:manage)", () => {
      beforeEach(() => {
        mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      });

      it("defaults submit to false — a plain save, not a submission", async () => {
        const lines = [{ lineId: "l1", countedQty: 5 }];
        const res = await saveCountsAction({ stocktakeId: "st1", lines });
        expect(res).toEqual({ ok: true, id: "st1" });
        expect(mockSave).toHaveBeenCalledWith({ stocktakeId: "st1", lines, addedLines: undefined, submit: false, userId: "user-1" });
      });

      it("honours an explicit submit: true", async () => {
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [], submit: true });
        expect(res).toEqual({ ok: true, id: "st1" });
        expect(mockSave).toHaveBeenCalledWith({ stocktakeId: "st1", lines: [], addedLines: undefined, submit: true, userId: "user-1" });
      });

      it("returns NOT_FOUND when the stocktakeId doesn't resolve to a document", async () => {
        mockFindStocktakeUnique.mockResolvedValue(null);
        const res = await saveCountsAction({ stocktakeId: "no-such", lines: [] });
        expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("never touches the SPG active-visit gate on the admin path", async () => {
        await saveCountsAction({ stocktakeId: "st1", lines: [] });
        expect(mockActiveVisit).not.toHaveBeenCalled();
      });

      it("revalidates the list, the document detail route, and the store detail route on success", async () => {
        mockFindStocktakeUnique.mockResolvedValue({ storeId: "store-xyz" });
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
        expect(res.ok).toBe(true);
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes");
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes/st1");
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/store-xyz");
      });

      for (const code of [
        "ALREADY_OPEN",
        "VARIANCE_NEEDS_REASON",
        "SHORTFALL_NEEDS_CAUSE",
        "ITEM_NOT_FOUND",
        "INVALID_REQUEST",
        "DUPLICATE_LINE",
        "INVALID_STATE",
        "NOT_FOUND",
      ] as const) {
        it(`maps a writer ${code} onto its own code, never a neighbouring one`, async () => {
          mockSave.mockRejectedValue(new StoreStocktakeError(code));
          const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
          expect(res).toEqual({ ok: false, code });
        });
      }

      it("maps an unknown throw onto ERROR rather than leaking it", async () => {
        mockSave.mockRejectedValue(new Error("boom"));
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
        expect(res).toEqual({ ok: false, code: "ERROR" });
      });
    });

    describe("SPG fill-existing path (stocktakeId, spg_sales:record)", () => {
      beforeEach(() => {
        mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "spg_sales:record");
      });

      /*
       * This is the exact case the brief calls out: an SPG holding spg_sales:record but with no
       * active check-in right now must be refused, not allowed through on the permission alone.
       */
      it("refuses the SPG submit path without an active check-in at the assigned store", async () => {
        mockActiveVisit.mockResolvedValue(null);
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [], submit: true });
        expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("refuses when the SPG has no assigned store at all", async () => {
        mockFindUser.mockResolvedValue({ assignedStoreId: null });
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
        expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("refuses when the target document belongs to a different store than the SPG's own", async () => {
        mockFindStocktakeUnique.mockResolvedValue({ storeId: "other-store" });
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [] });
        expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("fills the document and forces submit: true even if the caller passed false", async () => {
        const res = await saveCountsAction({ stocktakeId: "st1", lines: [], submit: false });
        expect(res).toEqual({ ok: true, id: "st1" });
        expect(mockSave).toHaveBeenCalledWith({ stocktakeId: "st1", lines: [], addedLines: undefined, submit: true, userId: "user-1" });
      });

      it("returns NOT_FOUND when the stocktakeId doesn't resolve to a document", async () => {
        mockFindStocktakeUnique.mockResolvedValue(null);
        const res = await saveCountsAction({ stocktakeId: "no-such", lines: [] });
        expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
        expect(mockSave).not.toHaveBeenCalled();
      });
    });

    describe("SPG create-if-absent path (storeId, spg_sales:record)", () => {
      beforeEach(() => {
        mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "spg_sales:record");
      });

      it("creates a document and submits when the SPG has no open stocktake yet", async () => {
        mockFindStocktakeFirst.mockResolvedValue(null);
        mockCreate.mockResolvedValue({ id: "new-st", docNo: "STOCKTAKE/0002" });
        const res = await saveCountsAction({ storeId: "s1", lines: [] });
        expect(res).toEqual({ ok: true, id: "new-st" });
        expect(mockCreate).toHaveBeenCalledWith({ storeId: "s1", createdById: "user-1", countedAt: expect.any(Date) });
        expect(mockSave).toHaveBeenCalledWith({ stocktakeId: "new-st", lines: [], addedLines: undefined, submit: true, userId: "user-1" });
      });

      it("reuses the already-open DRAFT the admin opened instead of creating a second one", async () => {
        mockFindStocktakeFirst.mockResolvedValue({ id: "existing-st" });
        const res = await saveCountsAction({ storeId: "s1", lines: [] });
        expect(res).toEqual({ ok: true, id: "existing-st" });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalledWith({ stocktakeId: "existing-st", lines: [], addedLines: undefined, submit: true, userId: "user-1" });
      });

      it("refuses without an active check-in at the store", async () => {
        mockActiveVisit.mockResolvedValue(null);
        const res = await saveCountsAction({ storeId: "s1", lines: [] });
        expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("refuses when the requested storeId doesn't match the SPG's own active-visit store", async () => {
        const res = await saveCountsAction({ storeId: "some-other-store", lines: [] });
        expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
      });

      it("revalidates the list, the created document's detail route, and the store detail route", async () => {
        mockFindStocktakeFirst.mockResolvedValue(null);
        mockCreate.mockResolvedValue({ id: "new-st", docNo: "STOCKTAKE/0002" });
        const res = await saveCountsAction({ storeId: "s1", lines: [] });
        expect(res.ok).toBe(true);
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes");
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes/new-st");
        expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/s1");
      });
    });

    /*
     * The core of the ruling that overrides the brief: the create-if-absent (storeId) branch
     * must be reachable ONLY on the SPG path. An admin who holds stores:manage but not
     * spg_sales:record must never reach it — that branch swallows ALREADY_OPEN by design, so
     * letting an admin in would let them dodge the refusal createAction enforces.
     */
    it("refuses the storeId create-if-absent shape for an admin without spg_sales:record", async () => {
      mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      const res = await saveCountsAction({ storeId: "s1", lines: [] });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe("approveAction", () => {
    it("returns FORBIDDEN without stores:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await approveAction("st1");
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("pins the permission it checks", async () => {
      mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      const res = await approveAction("st1");
      expect(res.ok).toBe(true);
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await approveAction("st1");
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for an empty stocktakeId without calling the writer", async () => {
      const res = await approveAction("");
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the document doesn't exist", async () => {
      mockFindStocktakeUnique.mockResolvedValue(null);
      const res = await approveAction("no-such");
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    for (const code of ["VARIANCE_NEEDS_REASON", "SHORTFALL_NEEDS_CAUSE", "ITEM_NOT_FOUND", "INVALID_STATE", "NOT_FOUND"] as const) {
      it(`maps a writer ${code} onto its own code`, async () => {
        mockApprove.mockRejectedValue(new StoreStocktakeError(code));
        const res = await approveAction("st1");
        expect(res).toEqual({ ok: false, code });
      });
    }

    it("maps an unknown throw onto ERROR without leaking it", async () => {
      mockApprove.mockRejectedValue(new Error("boom"));
      const res = await approveAction("st1");
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await approveAction("st1");
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("calls the writer with the current user id, succeeds, and revalidates list/detail/store routes", async () => {
      mockFindStocktakeUnique.mockResolvedValue({ storeId: "store-abc" });
      const res = await approveAction("st1");
      expect(res).toEqual({ ok: true, id: "st1" });
      expect(mockApprove).toHaveBeenCalledWith({ stocktakeId: "st1", approvedById: "user-1" });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes/st1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/store-abc");
    });
  });

  describe("cancelAction", () => {
    it("returns FORBIDDEN without stores:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it("pins the permission it checks", async () => {
      mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "stores:manage");
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res.ok).toBe(true);
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "stores:manage");
    });

    it("returns INVALID_REQUEST for a non-string reason without calling the writer", async () => {
      const res = await cancelAction({ stocktakeId: "st1", reason: 5 as unknown as string });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the document doesn't exist", async () => {
      mockFindStocktakeUnique.mockResolvedValue(null);
      const res = await cancelAction({ stocktakeId: "no-such", reason: "lost sack" });
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it("maps a writer INVALID_REQUEST (blank reason) onto its own code", async () => {
      mockCancel.mockRejectedValue(new StoreStocktakeError("INVALID_REQUEST"));
      const res = await cancelAction({ stocktakeId: "st1", reason: "" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });

    it("maps a writer INVALID_STATE onto its own code", async () => {
      mockCancel.mockRejectedValue(new StoreStocktakeError("INVALID_STATE"));
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("maps an unknown throw onto ERROR without leaking it", async () => {
      mockCancel.mockRejectedValue(new Error("boom"));
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("returns ERROR rather than throwing when auth() rejects", async () => {
      mockAuth.mockRejectedValue(new Error("boom"));
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it("calls the writer with the current user id, succeeds, and revalidates list/detail/store routes", async () => {
      mockFindStocktakeUnique.mockResolvedValue({ storeId: "store-def" });
      const res = await cancelAction({ stocktakeId: "st1", reason: "lost sack" });
      expect(res).toEqual({ ok: true, id: "st1" });
      expect(mockCancel).toHaveBeenCalledWith({ stocktakeId: "st1", cancelledById: "user-1", reason: "lost sack" });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/store-stocktakes/st1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/stores/store-def");
    });
  });
});
