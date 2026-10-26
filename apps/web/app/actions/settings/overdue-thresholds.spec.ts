import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindUnique, mockUpsert, mockRevalidate, mockAuditCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockRevalidate: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: {
    systemSetting: { findUnique: mockFindUnique, upsert: mockUpsert },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        systemSetting: { findUnique: mockFindUnique, upsert: mockUpsert },
        auditLog: { create: mockAuditCreate },
      }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

import { setOverdueThresholds } from "./overdue-thresholds";

describe("setOverdueThresholds", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFindUnique.mockReset();
    mockUpsert.mockReset();
    mockAuditCreate.mockReset();
    mockRevalidate.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["collections:manage"] } });
  });

  it("refuses without collections:manage", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    await expect(setOverdueThresholds("7,30")).rejects.toThrow();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("returns validation codes without writing or auditing", async () => {
    expect(await setOverdueThresholds(" ")).toEqual({ ok: false, code: "EMPTY" });
    expect(await setOverdueThresholds("7,x")).toEqual({ ok: false, code: "INVALID" });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("upserts and writes an audit row with before and after text", async () => {
    mockFindUnique.mockResolvedValue({ value: "7,14" });
    const result = await setOverdueThresholds("7,30");
    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "7,30" } }),
    );
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        action: "AR_OVERDUE_THRESHOLDS_UPDATE",
        entityType: "SystemSetting",
        entityId: "ar.overdueThresholdDays",
        changes: { before: { value: "7,14" }, after: { value: "7,30" } },
        reason: null,
      },
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/piutang");
  });

  it("records a null before when nothing was stored", async () => {
    mockFindUnique.mockResolvedValue(null);
    await setOverdueThresholds("7");
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changes: { before: { value: null }, after: { value: "7" } } }),
      }),
    );
  });
});
