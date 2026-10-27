import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFind, mockCount, mockCreate, mockUpdate, mockDelete, mockCompare } = vi.hoisted(() => ({
  mockUserFind: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockCompare: vi.fn(),
}));

vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: mockUserFind },
    pinAttempt: { count: mockCount, create: mockCreate, update: mockUpdate, delete: mockDelete },
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: mockCompare } }));

import { verifyPin } from "./pin";

describe("verifyPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFind.mockResolvedValue({ id: "u1", pinHash: "hash" });
    mockCount.mockResolvedValue(1);
    mockCreate.mockResolvedValue({ id: "a1" });
    mockCompare.mockResolvedValue(true);
  });

  it("returns userNotFound when the user is missing", async () => {
    mockUserFind.mockResolvedValue(null);
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "userNotFound" });
  });

  it("returns pinNotSet when the user has no PIN", async () => {
    mockUserFind.mockResolvedValue({ id: "u1", pinHash: null });
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "pinNotSet" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("blocks once the own reserved row makes the failure count exceed 3, and releases it", async () => {
    mockCount.mockResolvedValue(4);
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: false, messageKey: "tooManyAttempts" });
    const where = mockCount.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.success).toBe(false);
    expect(where.action).toEqual({ not: "CHANGE_PASSWORD" });
    const age = Date.now() - where.createdAt.gte.getTime();
    expect(age).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(age).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  it("allows the third failed guess (count 3 including the reserved row)", async () => {
    mockCount.mockResolvedValue(3);
    mockCompare.mockResolvedValue(false);
    const r = await verifyPin("u1", "0000", "A");
    expect(r).toEqual({ success: false, messageKey: "pinIncorrect" });
  });

  it("reserves a failed row before comparing and keeps it on a wrong PIN", async () => {
    mockCompare.mockResolvedValue(false);
    const r = await verifyPin("u1", "0000", "A", { ipAddress: "1.2.3.4" });
    expect(r).toEqual({ success: false, messageKey: "pinIncorrect" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: "u1", action: "A", success: false, ipAddress: "1.2.3.4" } })
    );
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockCompare.mock.invocationCallOrder[0]);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("updates the reserved row to success and returns the user id on a match", async () => {
    const r = await verifyPin("u1", "1234", "A");
    expect(r).toEqual({ success: true, messageKey: "ok", userId: "u1" });
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "a1" }, data: { success: true } });
  });
});
