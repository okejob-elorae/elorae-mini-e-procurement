import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockUserFind, mockUserUpdate, mockCompare, mockHash } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFind: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockCompare: vi.fn(),
  mockHash: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: { user: { findUnique: mockUserFind, update: mockUserUpdate } },
}));
vi.mock("bcryptjs", () => ({ default: { compare: mockCompare, hash: mockHash } }));

import { changePassword } from "./change-password";

describe("changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("reads and updates the session user's row", async () => {
    mockUserFind.mockResolvedValue({ passwordHash: "old" });
    mockCompare.mockResolvedValue(true);
    mockHash.mockResolvedValue("new");
    const r = await changePassword("current", "newpass1");
    expect(r).toEqual({ success: true });
    expect(mockUserFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { passwordHash: "new" } });
  });

  it("returns unauthorized and touches no prisma without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await changePassword("current", "newpass1");
    expect(r).toEqual({ success: false, messageKey: "unauthorized" });
    expect(mockUserFind).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
