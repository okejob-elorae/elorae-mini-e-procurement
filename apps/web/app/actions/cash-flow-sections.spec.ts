import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, update } = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: { chartAccount: { findUnique, update } },
  };
});

import { Prisma } from "@elorae/db";
import { clearCashFlowSectionAction, setCashFlowSectionAction } from "./cash-flow-sections";

function p2025() {
  return new Prisma.PrismaClientKnownRequestError("gone", {
    code: "P2025",
    clientVersion: "test",
  });
}

describe("cash flow section actions failure mapping", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("maps a P2025 on the write to NOT_FOUND", async () => {
    findUnique.mockResolvedValue({ type: "ASET", id: "a" });
    update.mockRejectedValue(p2025());

    expect(await setCashFlowSectionAction("a", "INVESTASI")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await clearCashFlowSectionAction("a")).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("maps any other failure to UNEXPECTED instead of throwing", async () => {
    findUnique.mockRejectedValue(new Error("connection lost"));

    expect(await setCashFlowSectionAction("a", "INVESTASI")).toEqual({
      ok: false,
      code: "UNEXPECTED",
    });
    expect(await clearCashFlowSectionAction("a")).toEqual({ ok: false, code: "UNEXPECTED" });
  });

  it("still returns ok on a clean write", async () => {
    findUnique.mockResolvedValue({ type: "ASET", id: "a" });
    update.mockResolvedValue({});

    expect(await setCashFlowSectionAction("a", "INVESTASI")).toEqual({ ok: true });
  });
});
