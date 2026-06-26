import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    chartAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
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

import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import {
  createAccountAction,
  updateAccountAction,
  deactivateAccountAction,
  reactivateAccountAction,
} from "./actions";

const mockSession = (perms: string[]) => ({ user: { id: "u1", permissions: perms } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createAccountAction", () => {
  it("returns forbidden without coa:manage", async () => {
    (auth as any).mockResolvedValue(mockSession([]));
    const r = await createAccountAction({ code: "12", name: "x", parentId: "a" });
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("creates a root account when type given and parentId null", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.chartAccount.findUnique as any).mockResolvedValue(null); // no existing
    (prisma.chartAccount.create as any).mockResolvedValue({ id: "n1" });
    const r = await createAccountAction({ code: "7", name: "Lainnya", parentId: null, type: "BEBAN" });
    expect(r).toEqual({ ok: true });
    expect(prisma.chartAccount.create).toHaveBeenCalled();
  });

  it("rejects creation under inactive parent", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "a", code: "1", type: "ASET", depth: 1, isActive: false, parentId: null });
    const r = await createAccountAction({ code: "11", name: "x", parentId: "a" });
    expect(r).toMatchObject({ ok: false, code: "parent_inactive" });
  });

  it("rejects duplicate code with code_duplicate", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.chartAccount.findUnique as any)
      .mockResolvedValueOnce({ id: "a", code: "1", type: "ASET", depth: 1, isActive: true, parentId: null }) // parent
      .mockResolvedValueOnce({ id: "exists", code: "11" }); // existing-with-same-code
    const r = await createAccountAction({ code: "11", name: "x", parentId: "a" });
    expect(r).toMatchObject({ ok: false, code: "code_duplicate" });
  });
});

describe("deactivateAccountAction", () => {
  it("rejects when active children exist", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "a", code: "1", type: "ASET", depth: 1, isActive: true, parentId: null });
    (prisma.chartAccount.count as any).mockResolvedValue(2);
    const r = await deactivateAccountAction("a");
    expect(r).toMatchObject({ ok: false, code: "has_active_children" });
  });

  it("deactivates a leaf with no children", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "c", code: "1101", type: "ASET", depth: 3, isActive: true, parentId: "b" });
    (prisma.chartAccount.count as any).mockResolvedValue(0);
    (prisma.chartAccount.update as any).mockResolvedValue({ id: "c" });
    const r = await deactivateAccountAction("c");
    expect(r).toEqual({ ok: true });
  });
});

describe("reactivateAccountAction", () => {
  it("reactivates a previously deactivated account", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "c", isActive: false });
    (prisma.chartAccount.update as any).mockResolvedValue({ id: "c" });
    const r = await reactivateAccountAction("c");
    expect(r).toEqual({ ok: true });
  });
});

describe("updateAccountAction", () => {
  it("updates name on a non-leaf account", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "a", code: "1", type: "ASET", depth: 1, isActive: true, parentId: null });
    (prisma.chartAccount.count as any).mockResolvedValue(3); // has children
    (prisma.chartAccount.update as any).mockResolvedValue({ id: "a" });
    const r = await updateAccountAction("a", { name: "Aset Renamed" });
    expect(r).toEqual({ ok: true });
  });
  it("rejects code change on non-leaf account", async () => {
    (auth as any).mockResolvedValue(mockSession(["coa:manage"]));
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.chartAccount.findUnique as any).mockResolvedValue({ id: "a", code: "1", type: "ASET", depth: 1, isActive: true, parentId: null });
    (prisma.chartAccount.count as any).mockResolvedValue(3);
    const r = await updateAccountAction("a", { code: "9" });
    expect(r).toMatchObject({ ok: false, code: "has_children_code_change_forbidden" });
  });
});
