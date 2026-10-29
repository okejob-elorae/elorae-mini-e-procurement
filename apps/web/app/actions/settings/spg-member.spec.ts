import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_BAWAAN } from "@/lib/spg/member";

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

import { simpanAturanMemberSpg } from "./spg-member";

const nyala = { ...MEMBER_BAWAAN, diskonAktif: true, hariTidur: 60 };

describe("simpanAturanMemberSpg", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockRevalidate, tx.systemSetting.findUnique, tx.systemSetting.upsert, tx.auditLog.create]) m.mockReset();
    mockTransaction.mockClear();
  });

  it("needs a session and promos:manage", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await simpanAturanMemberSpg(nyala)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["spg_sales:view", "stores:manage"] } });
    expect(await simpanAturanMemberSpg(nyala)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses a rule the receipt writer would read differently", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["promos:manage"] } });
    expect(await simpanAturanMemberSpg({ ...nyala, hariTidur: 3 })).toEqual({ ok: false, code: "INVALID" });
    expect(await simpanAturanMemberSpg({ ...nyala, tingkat: [{ kode: "A", nama: "A", minBelanja: 100, diskonPersen: 0 }] })).toEqual({ ok: false, code: "INVALID" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("saves the setting and its before/after trail in the same transaction, dropping unknown keys", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["promos:manage"] } });
    tx.systemSetting.findUnique.mockResolvedValue(null);
    expect(await simpanAturanMemberSpg({ ...nyala, lain: 1 } as never)).toEqual({ ok: true });
    expect(tx.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "spg.member" }, update: { value: JSON.stringify(nyala) } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "SPG_MEMBER_SETTINGS_UPDATED",
        entityType: "SystemSetting",
        entityId: "spg.member",
        changes: { before: MEMBER_BAWAAN, after: nyala },
      }),
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/spg");
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/spg-pelanggan");
  });
});
