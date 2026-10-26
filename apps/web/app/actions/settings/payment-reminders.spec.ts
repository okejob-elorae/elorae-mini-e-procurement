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

import { getPaymentReminderDays, setPaymentReminderDays } from "./payment-reminders";

describe("setPaymentReminderDays", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockUpsert.mockReset();
    mockFindUnique.mockReset();
    mockAuditCreate.mockReset();
    mockRevalidate.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:edit"] } });
  });

  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(setPaymentReminderDays("-7,0")).rejects.toThrow("Unauthorized");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses without purchase_orders:edit", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:view"] } });
    await expect(setPaymentReminderDays("-7,0")).rejects.toThrow("Forbidden");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns each validation code without writing", async () => {
    expect(await setPaymentReminderDays("  ")).toEqual({ ok: false, code: "EMPTY" });
    expect(await setPaymentReminderDays("1.5")).toEqual({ ok: false, code: "INVALID" });
    expect(await setPaymentReminderDays("400")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("stores the normalised list and revalidates the page", async () => {
    mockFindUnique.mockResolvedValue({ value: "-1,0" });
    const result = await setPaymentReminderDays(" 7, -7 ,0,-7");
    expect(result).toEqual({ ok: true, days: [-7, 0, 7] });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "po.paymentReminderDays" },
      create: { key: "po.paymentReminderDays", value: "-7,0,7" },
      update: { value: "-7,0,7" },
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/purchasing");
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        action: "PO_PAYMENT_REMINDER_DAYS_UPDATE",
        entityType: "SystemSetting",
        entityId: "po.paymentReminderDays",
        changes: { before: { value: "-1,0" }, after: { value: "-7,0,7" } },
        reason: null,
      },
    });
  });

  it("records a null before when no value was stored", async () => {
    mockFindUnique.mockResolvedValue(null);
    await setPaymentReminderDays("0");
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changes: { before: { value: null }, after: { value: "0" } } }),
      }),
    );
  });
});

describe("getPaymentReminderDays", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFindUnique.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:view"] } });
  });

  it("returns the default when nothing is stored", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getPaymentReminderDays()).toEqual([-7, -1, 0, 7]);
  });

  it("returns the stored days", async () => {
    mockFindUnique.mockResolvedValue({ value: "-3,3" });
    expect(await getPaymentReminderDays()).toEqual([-3, 3]);
  });

  it("refuses without purchase_orders:view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    await expect(getPaymentReminderDays()).rejects.toThrow("Forbidden");
  });
});
