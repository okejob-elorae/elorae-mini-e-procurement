import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFind, mockCount, mockCreate, mockCompare } = vi.hoisted(() => ({
  mockUserFind: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockCompare: vi.fn(),
}));

vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: mockUserFind },
    pinAttempt: { count: mockCount, create: mockCreate },
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: mockCompare } }));

import { verifyPin } from "./pin";

describe("verifyPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFind.mockResolvedValue({ id: "u1", pinHash: "hash" });
    mockCount.mockResolvedValue(0);
    mockCompare.mockResolvedValue(true);
  });

  it("returns userNotFound when the user is missing", async () => {
    mockUserFind.mockResolvedValue(null);
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "userNotFound" });
  });

  it("falls back to the email lookup when the id is unknown", async () => {
    mockUserFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "u2", pinHash: "hash" });
    const r = await verifyPin("stale", "1234", "A", { fallbackEmail: " a@b.c " });
    expect(mockUserFind).toHaveBeenLastCalledWith(expect.objectContaining({ where: { email: "a@b.c" } }));
    expect(r).toEqual({ success: true, messageKey: "ok", userId: "u2" });
  });

  it("returns pinNotSet when the user has no PIN", async () => {
    mockUserFind.mockResolvedValue({ id: "u1", pinHash: null });
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "pinNotSet" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("blocks after 3 failed attempts in the 15 minute window", async () => {
    mockCount.mockResolvedValue(3);
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "tooManyAttempts" });
    const where = mockCount.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.success).toBe(false);
    const age = Date.now() - where.createdAt.gte.getTime();
    expect(age).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(age).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it("records a failed attempt on a wrong PIN", async () => {
    mockCompare.mockResolvedValue(false);
    const r = await verifyPin("u1", "0000", "A", { ipAddress: "1.2.3.4" });
    expect(r).toEqual({ success: false, messageKey: "pinIncorrect" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: "u1", action: "A", success: false, ipAddress: "1.2.3.4" },
    });
  });

  it("returns ok with the user id on success", async () => {
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: true, messageKey: "ok", userId: "u1" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: "u1", action: "A", success: true, ipAddress: null },
    });
  });
});
