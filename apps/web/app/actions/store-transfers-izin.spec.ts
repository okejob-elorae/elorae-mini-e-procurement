import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Team store transfers after the owner's 2026-11-01 split: approving takes
 * `store_transfers:approve`, no longer `stores:manage`. Every transfer is PENDING
 * until approved, so cancelling someone ELSE's is the reject half of that approval
 * and takes the same code; a `stores:manage` holder may still withdraw a transfer
 * they created. Unit-only: the writers and the creator lookup are mocked.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  createdById: "u1" as string | null,
  called: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    storeTransfer: {
      findUnique: vi.fn(async () => (state.createdById === null ? null : { createdById: state.createdById })),
    },
  },
}));
vi.mock("@/lib/stores/transfer/queries", () => ({ getStoreStockForTransfer: vi.fn(async () => []) }));
vi.mock("@/lib/stores/transfer/writer", () => ({
  createStoreTransfer: vi.fn(),
  approveStoreTransfer: vi.fn(async () => {
    state.called.push("approveStoreTransfer");
    return { ok: true };
  }),
  cancelStoreTransfer: vi.fn(async () => {
    state.called.push("cancelStoreTransfer");
    return { ok: true };
  }),
}));

const actions = await import("./store-transfers");

const signIn = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.createdById = "u1";
  state.called = [];
});

const FORBIDDEN = { ok: false, code: "FORBIDDEN" };

describe("approveStoreTransferAction: store_transfers:approve", () => {
  it("refuses a store manager without the approval code", async () => {
    signIn(["stores:manage"]);
    expect(await actions.approveStoreTransferAction("t1")).toEqual(FORBIDDEN);
    expect(state.called).toEqual([]);
  });

  it("approves on the approval code alone", async () => {
    signIn(["store_transfers:approve"]);
    expect(await actions.approveStoreTransferAction("t1")).toEqual({ ok: true, id: "t1" });
    expect(state.called).toEqual(["approveStoreTransfer"]);
  });
});

describe("cancelStoreTransferAction: the approver cancels any, a store manager only their own", () => {
  it("lets a store manager withdraw a transfer they created", async () => {
    signIn(["stores:manage"]);
    expect(await actions.cancelStoreTransferAction("t1")).toEqual({ ok: true, id: "t1" });
    expect(state.called).toEqual(["cancelStoreTransfer"]);
  });

  it("refuses a store manager cancelling someone else's transfer, without calling the writer", async () => {
    signIn(["stores:manage"]);
    state.createdById = "someone-else";
    expect(await actions.cancelStoreTransferAction("t1")).toEqual(FORBIDDEN);
    expect(state.called).toEqual([]);
  });

  it("lets the approver cancel someone else's transfer", async () => {
    signIn(["store_transfers:approve"]);
    state.createdById = "someone-else";
    expect(await actions.cancelStoreTransferAction("t1")).toEqual({ ok: true, id: "t1" });
    expect(state.called).toEqual(["cancelStoreTransfer"]);
  });

  it("refuses without either code, and reports NOT_FOUND for a store manager's missing transfer", async () => {
    signIn(["stores:view"]);
    expect(await actions.cancelStoreTransferAction("t1")).toEqual(FORBIDDEN);
    signIn(["stores:manage"]);
    state.createdById = null;
    expect(await actions.cancelStoreTransferAction("t1")).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(state.called).toEqual([]);
  });
});
