import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRevalidate, tx, mockTransaction } = vi.hoisted(() => {
  const tx = {
    systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    mockAuth: vi.fn(),
    mockRevalidate: vi.fn(),
    tx,
    mockTransaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
});
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@elorae/db", () => ({ prisma: { $transaction: mockTransaction } }));

import { simpanAturanTutupHari } from "./spg-tutup-hari";

const aturan = { tanyaPengunjung: false, tanyaTotalKasir: true, wajibFoto: true };

describe("simpanAturanTutupHari", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockRevalidate, tx.systemSetting.findUnique, tx.systemSetting.upsert, tx.auditLog.create]) m.mockReset();
    mockTransaction.mockClear();
  });

  it("needs a session and stores:manage", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await simpanAturanTutupHari(aturan)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["spg_sales:view"] } });
    expect(await simpanAturanTutupHari(aturan)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses anything that is not three booleans", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:manage"] } });
    expect(await simpanAturanTutupHari({ ...aturan, wajibFoto: "ya" } as never)).toEqual({ ok: false, code: "INVALID" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("saves the setting and its before/after trail in the same transaction", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:manage"] } });
    tx.systemSetting.findUnique.mockResolvedValue(null);
    expect(await simpanAturanTutupHari({ ...aturan, lain: 1 } as never)).toEqual({ ok: true });
    expect(tx.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "spg.tutupHari" }, update: { value: JSON.stringify(aturan) } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "SPG_DAILY_CLOSE_SETTINGS_UPDATED",
        entityId: "spg.tutupHari",
        changes: { before: { tanyaPengunjung: true, tanyaTotalKasir: true, wajibFoto: false }, after: aturan },
      }),
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/spg");
  });
});
