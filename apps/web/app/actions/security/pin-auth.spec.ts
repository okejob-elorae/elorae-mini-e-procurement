import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockUserFind, mockUserUpdate, mockAttemptFindMany, mockVerifyPin, mockCompare, mockHash } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockUserFind: vi.fn(),
    mockUserUpdate: vi.fn(),
    mockAttemptFindMany: vi.fn(),
    mockVerifyPin: vi.fn(),
    mockCompare: vi.fn(),
    mockHash: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: mockUserFind, update: mockUserUpdate },
    pinAttempt: { findMany: mockAttemptFindMany },
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: mockCompare, hash: mockHash } }));
vi.mock("@/lib/security/pin", () => ({ verifyPin: mockVerifyPin }));

import { getLastSensitiveAccess, getPinAttempts, setupPin } from "./pin-auth";

describe("pin-auth self-service actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "u1@x.test" } });
  });

  describe("setupPin", () => {
    it("reads and writes the session user's row", async () => {
      mockUserFind.mockResolvedValue({ pinHash: null });
      mockHash.mockResolvedValue("newhash");
      const r = await setupPin("1234");
      expect(r).toEqual({ success: true, messageKey: "pinSaved" });
      expect(mockUserFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
      expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { pinHash: "newhash" } });
    });

    it("returns unauthorized and touches no prisma without a session", async () => {
      mockAuth.mockResolvedValue(null);
      const r = await setupPin("1234");
      expect(r).toEqual({ success: false, messageKey: "unauthorized" });
      expect(mockUserFind).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("refuses a change without the current PIN when one is set", async () => {
      mockUserFind.mockResolvedValue({ pinHash: "oldhash" });
      const r = await setupPin("5678");
      expect(r).toEqual({ success: false, messageKey: "enterCurrentPin" });
      expect(mockVerifyPin).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("checks the current PIN through verifyPin and keeps the PIN on a wrong one", async () => {
      mockUserFind.mockResolvedValue({ pinHash: "oldhash" });
      mockVerifyPin.mockResolvedValue({ success: false, messageKey: "pinIncorrect" });
      const r = await setupPin("5678", "0000");
      expect(r).toEqual({ success: false, messageKey: "currentPinIncorrect" });
      expect(mockVerifyPin).toHaveBeenCalledWith("u1", "0000", "CHANGE_PIN", {
        fallbackEmail: "u1@x.test",
      });
      expect(mockCompare).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("passes a lockout through and keeps the PIN", async () => {
      mockUserFind.mockResolvedValue({ pinHash: "oldhash" });
      mockVerifyPin.mockResolvedValue({ success: false, messageKey: "tooManyAttempts" });
      const r = await setupPin("5678", "1234");
      expect(r).toEqual({ success: false, messageKey: "tooManyAttempts" });
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("replaces the PIN once the current PIN verifies", async () => {
      mockUserFind.mockResolvedValue({ pinHash: "oldhash" });
      mockVerifyPin.mockResolvedValue({ success: true, messageKey: "ok", userId: "u1" });
      mockHash.mockResolvedValue("newhash");
      const r = await setupPin("5678", "1234");
      expect(r).toEqual({ success: true, messageKey: "pinSaved" });
      expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { pinHash: "newhash" } });
    });
  });

  describe("getPinAttempts", () => {
    it("queries the session user's attempts", async () => {
      mockAttemptFindMany.mockResolvedValue([]);
      await getPinAttempts(5);
      expect(mockAttemptFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u1" }, take: 5 })
      );
    });

    it("returns [] without a session", async () => {
      mockAuth.mockResolvedValue(null);
      expect(await getPinAttempts()).toEqual([]);
      expect(mockAttemptFindMany).not.toHaveBeenCalled();
    });
  });

  describe("getLastSensitiveAccess", () => {
    it("queries the session user's successful attempts", async () => {
      mockAttemptFindMany.mockResolvedValue([]);
      await getLastSensitiveAccess();
      expect(mockAttemptFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: "u1", success: true }) })
      );
    });

    it("returns [] without a session", async () => {
      mockAuth.mockResolvedValue(null);
      expect(await getLastSensitiveAccess()).toEqual([]);
      expect(mockAttemptFindMany).not.toHaveBeenCalled();
    });
  });
});
