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

import {
  getLastSensitiveAccess,
  getPinAttempts,
  setupPin,
  verifyPinForAction,
} from "./pin-auth";

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

  describe("verifyPinForAction", () => {
    it("verifies the session user with ip and fallback email", async () => {
      mockVerifyPin.mockResolvedValue({ success: true, messageKey: "ok", userId: "u1" });
      const r = await verifyPinForAction("1234", "DELETE_SUPPLIER", "9.9.9.9");
      expect(mockVerifyPin).toHaveBeenCalledWith("u1", "1234", "DELETE_SUPPLIER", {
        ipAddress: "9.9.9.9",
        fallbackEmail: "u1@x.test",
      });
      expect(r.success).toBe(true);
    });

    it("returns unauthorized without a session", async () => {
      mockAuth.mockResolvedValue(null);
      const r = await verifyPinForAction("1234", "A");
      expect(r).toEqual({ success: false, messageKey: "unauthorized" });
      expect(mockVerifyPin).not.toHaveBeenCalled();
    });
  });
});
