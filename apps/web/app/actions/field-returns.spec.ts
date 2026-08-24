import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit-only: auth, rbac and all three writers are mocked, so nothing here touches the shared
 * dev database. Each writer already has its own DB-backed spec — this file exists to pin the
 * permission gate + error-code mapping the actions add on top of them.
 */
const { mockAuth, mockHasPermission, mockReceive, mockResolve, mockApprove, mockRevalidatePath } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockHasPermission: vi.fn(),
    mockReceive: vi.fn(),
    mockResolve: vi.fn(),
    mockApprove: vi.fn(),
    mockRevalidatePath: vi.fn(),
  })
);

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/field-sales/retur/receive-writer", () => ({ receiveFieldReturn: mockReceive }));
vi.mock("@/lib/field-sales/retur/resolve-writer", () => ({ resolveFieldReturnLine: mockResolve }));
vi.mock("@/lib/field-sales/retur/approve-writer", () => ({ approveFieldReturn: mockApprove }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { FieldReturnError } from "@/lib/field-sales/retur/errors";
import { receiveAction, resolveAction, approveAction } from "./field-returns";

describe("field retur receiving actions (unit — writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockReceive.mockReset();
    mockResolve.mockReset();
    mockApprove.mockReset();
    mockRevalidatePath.mockReset();
    mockAuth.mockResolvedValue({
      user: { id: "user-1", permissions: ["field_returns:manage", "field_returns:writeoff"] },
    });
  });

  describe("receiveAction", () => {
    it("returns FORBIDDEN without field_returns:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    /*
     * The FORBIDDEN/allow cases above mock hasPermission to return false/true for ANY code, so
     * they would stay green even if guard() checked a different permission entirely (e.g.
     * accidentally "stores:view"). Pin the actual code being asked for.
     */
    it("checks specifically for field_returns:manage, not some other code", async () => {
      mockHasPermission.mockImplementation((_permissions: unknown, code: string) => code === "field_returns:manage");
      mockReceive.mockResolvedValue({ ok: true, status: "PENDING_APPROVAL" });
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: true });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "field_returns:manage");
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a non-string returnId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await receiveAction({ returnId: 1 as unknown as string, counts: [] });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a malformed count line without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "l1", receivedQty: "3", sellableQty: 3, rejectedQty: 0 } as unknown as {
          lineId: string;
          receivedQty: number;
          sellableQty: number;
          rejectedQty: number;
        }],
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    /*
     * isValidReceiveInput only checked `typeof === "number"`, so a negative or fractional
     * count reached the writer and depended entirely on its own BAD_QTY backstop. Pin the
     * action-layer guard directly so the request-shape error surfaces as INVALID_REQUEST from
     * the layer that owns request shape, with the writer's own check as a second net.
     */
    it("returns INVALID_REQUEST for a negative receivedQty without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "l1", receivedQty: -1, sellableQty: -1, rejectedQty: 0 }],
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a fractional sellableQty without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "l1", receivedQty: 3, sellableQty: 2.5, rejectedQty: 0.5 }],
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    it("maps a writer SPLIT_MISMATCH onto its own code, not a neighbouring one", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("SPLIT_MISMATCH"));
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "l1", receivedQty: 3, sellableQty: 1, rejectedQty: 1 }],
      });
      expect(res).toEqual({ ok: false, code: "SPLIT_MISMATCH" });
    });

    it("maps a writer DUPLICATE_LINE onto its own code rather than a generic ERROR", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("DUPLICATE_LINE"));
      const res = await receiveAction({
        returnId: "r1",
        counts: [
          { lineId: "l1", receivedQty: 1, sellableQty: 1, rejectedQty: 0 },
          { lineId: "l1", receivedQty: 1, sellableQty: 1, rejectedQty: 0 },
        ],
      });
      expect(res).toEqual({ ok: false, code: "DUPLICATE_LINE" });
    });

    it("maps a writer UNKNOWN_LINE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("UNKNOWN_LINE"));
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "not-a-real-line", receivedQty: 1, sellableQty: 1, rejectedQty: 0 }],
      });
      expect(res).toEqual({ ok: false, code: "UNKNOWN_LINE" });
    });

    it("maps a writer MISSING_LINE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("MISSING_LINE"));
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "MISSING_LINE" });
    });

    it("maps a writer BAD_QTY onto INVALID_REQUEST, not a state code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("BAD_QTY"));
      const res = await receiveAction({
        returnId: "r1",
        counts: [{ lineId: "l1", receivedQty: -1, sellableQty: 0, rejectedQty: 0 }],
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });

    it("maps a writer NOT_FOUND onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("NOT_FOUND"));
      const res = await receiveAction({ returnId: "no-such-return", counts: [] });
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("maps a writer INVALID_STATE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new FieldReturnError("INVALID_STATE"));
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("maps an unknown throw onto ERROR rather than leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockRejectedValue(new Error("boom"));
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    /*
     * guard() calls auth() unwrapped in the family of "unknown throw" cases above too, but
     * every one of them rejects the WRITER mock — none of them exercise auth() itself throwing.
     * This pins the other call site: a corrupted session cookie or a DB hiccup during the
     * session lookup must not escape the action as an uncaught rejection.
     */
    it("maps auth() itself throwing onto ERROR rather than letting it escape uncaught", async () => {
      mockAuth.mockRejectedValue(new Error("jwt decrypt failed"));
      const res = await receiveAction({ returnId: "r1", counts: [] });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockReceive).not.toHaveBeenCalled();
    });

    it("calls the writer with the current user id, succeeds, and revalidates the list and detail routes", async () => {
      mockHasPermission.mockReturnValue(true);
      mockReceive.mockResolvedValue({ ok: true, status: "PENDING_APPROVAL" });
      const counts = [{ lineId: "l1", receivedQty: 3, sellableQty: 3, rejectedQty: 0 }];
      const res = await receiveAction({ returnId: "r1", counts });
      expect(res).toEqual({ ok: true });
      expect(mockReceive).toHaveBeenCalledWith({ returnId: "r1", receivedById: "user-1", counts });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns/r1");
    });
  });

  describe("resolveAction", () => {
    it("returns FORBIDDEN without field_returns:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("checks specifically for field_returns:manage in the base guard, not some other code", async () => {
      mockHasPermission.mockImplementation((_permissions: unknown, code: string) => code === "field_returns:manage");
      mockResolve.mockResolvedValue({ ok: true, returnId: "r1", returnStatus: "PENDING_APPROVAL" });
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: true });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "field_returns:manage");
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("refuses WRITE_OFF without field_returns:writeoff, naming that specifically", async () => {
      mockHasPermission.mockImplementation((_p, code) => code !== "field_returns:writeoff");
      const res = await resolveAction({ lineId: "l1", type: "WRITE_OFF" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN_WRITEOFF" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("allows a non-writeoff resolution with only field_returns:manage", async () => {
      mockHasPermission.mockImplementation((_p, code) => code !== "field_returns:writeoff");
      mockResolve.mockResolvedValue({ ok: true, returnId: "r1", returnStatus: "PENDING_APPROVAL" });
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: true });
    });

    /*
     * The write-off gate is one data comparison (`type === "WRITE_OFF"`), not a per-type
     * branch — SALESMAN_BEARS alone proved that comparison exists, but not that it stays a
     * single comparison rather than drifting into a per-type allowlist that happens to miss
     * one of these two.
     */
    it("allows INVESTIGATE without field_returns:writeoff", async () => {
      mockHasPermission.mockImplementation((_p, code) => code !== "field_returns:writeoff");
      mockResolve.mockResolvedValue({ ok: true, returnId: "r1", returnStatus: "MISMATCH_PENDING_RESOLUTION" });
      const res = await resolveAction({ lineId: "l1", type: "INVESTIGATE" });
      expect(res).toEqual({ ok: true });
    });

    it("allows ACCEPT_SURPLUS without field_returns:writeoff", async () => {
      mockHasPermission.mockImplementation((_p, code) => code !== "field_returns:writeoff");
      mockResolve.mockResolvedValue({ ok: true, returnId: "r1", returnStatus: "PENDING_APPROVAL" });
      const res = await resolveAction({ lineId: "l1", type: "ACCEPT_SURPLUS" });
      expect(res).toEqual({ ok: true });
    });

    it("allows WRITE_OFF when the user holds field_returns:writeoff", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockResolvedValue({ ok: true, returnId: "r1", returnStatus: "PENDING_APPROVAL" });
      const res = await resolveAction({ lineId: "l1", type: "WRITE_OFF", note: "unsellable" });
      expect(res).toEqual({ ok: true });
      expect(mockResolve).toHaveBeenCalledWith({
        lineId: "l1",
        type: "WRITE_OFF",
        note: "unsellable",
        createdById: "user-1",
      });
    });

    it("returns INVALID_REQUEST for an unrecognised resolution type without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await resolveAction({ lineId: "l1", type: "SOMETHING_ELSE" as unknown as "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a missing lineId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await resolveAction({ lineId: "", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("maps a writer NO_VARIANCE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockRejectedValue(new FieldReturnError("NO_VARIANCE"));
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "NO_VARIANCE" });
    });

    it("maps a writer RESOLUTION_DIRECTION_MISMATCH onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockRejectedValue(new FieldReturnError("RESOLUTION_DIRECTION_MISMATCH"));
      const res = await resolveAction({ lineId: "l1", type: "ACCEPT_SURPLUS" });
      expect(res).toEqual({ ok: false, code: "RESOLUTION_DIRECTION_MISMATCH" });
    });

    it("maps a writer NOT_FOUND onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockRejectedValue(new FieldReturnError("NOT_FOUND"));
      const res = await resolveAction({ lineId: "no-such-line", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("maps a writer INVALID_STATE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockRejectedValue(new FieldReturnError("INVALID_STATE"));
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("maps an unknown throw onto ERROR rather than leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockRejectedValue(new Error("boom"));
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("maps auth() itself throwing onto ERROR rather than letting it escape uncaught", async () => {
      mockAuth.mockRejectedValue(new Error("jwt decrypt failed"));
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockResolve).not.toHaveBeenCalled();
    });

    /*
     * The operator resolving a line is standing on that retur's DETAIL page — the writer's
     * returnId (not anything derived from the lineId or guessed client-side) is what the
     * detail route revalidation must use. A distinct id here proves the action reads it from
     * the writer's result rather than the input.
     */
    it("revalidates the retur's own detail route using the writer's returned returnId, not the list alone", async () => {
      mockHasPermission.mockReturnValue(true);
      mockResolve.mockResolvedValue({ ok: true, returnId: "distinct-return-id", returnStatus: "PENDING_APPROVAL" });
      const res = await resolveAction({ lineId: "l1", type: "SALESMAN_BEARS" });
      expect(res).toEqual({ ok: true });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns/distinct-return-id");
    });
  });

  describe("approveAction", () => {
    it("returns FORBIDDEN without field_returns:manage and never calls the writer", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("checks specifically for field_returns:manage, not some other code", async () => {
      mockHasPermission.mockImplementation((_permissions: unknown, code: string) => code === "field_returns:manage");
      mockApprove.mockResolvedValue({ ok: true });
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: true });
      expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "field_returns:manage");
    });

    it("returns FORBIDDEN when auth() resolves to a session with no user id", async () => {
      mockAuth.mockResolvedValue({ user: null });
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for an empty returnId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await approveAction("");
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("maps UNRESOLVED_LINES from the writer onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockApprove.mockRejectedValue(new FieldReturnError("UNRESOLVED_LINES"));
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "UNRESOLVED_LINES" });
    });

    it("maps a writer NOT_FOUND onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockApprove.mockRejectedValue(new FieldReturnError("NOT_FOUND"));
      const res = await approveAction("no-such-return");
      expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("maps a writer INVALID_STATE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockApprove.mockRejectedValue(new FieldReturnError("INVALID_STATE"));
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("maps an unknown throw onto ERROR without leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockApprove.mockRejectedValue(new Error("boom"));
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("maps auth() itself throwing onto ERROR rather than letting it escape uncaught", async () => {
      mockAuth.mockRejectedValue(new Error("jwt decrypt failed"));
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: false, code: "ERROR" });
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it("calls the writer with the current user id, succeeds, and revalidates the list and detail routes", async () => {
      mockHasPermission.mockReturnValue(true);
      mockApprove.mockResolvedValue({ ok: true });
      const res = await approveAction("r1");
      expect(res).toEqual({ ok: true });
      expect(mockApprove).toHaveBeenCalledWith({ returnId: "r1", approvedById: "user-1" });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/field-returns/r1");
    });
  });
});
