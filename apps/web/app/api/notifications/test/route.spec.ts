import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * POST /api/notifications/test — alat pemeriksa push. Dulu siapa pun yang masuk
 * bisa memanggilnya (tombolnya hanya disembunyikan di layar). Kini server
 * menolak selain admin sistem (`*`) dan pemegang `settings_security:manage`.
 */

vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    notificationQueue: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ messaging: null }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.notificationQueue.create as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue({ id: "u1", fcmToken: null });
  mockCreate.mockResolvedValue({ id: "n1" });
});

describe("POST /api/notifications/test", () => {
  it("401 tanpa sesi", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("403 untuk pengguna tanpa izin — tidak ada baris yang ditulis", async () => {
    for (const permissions of [[], ["pwa:access"], ["settings_security:view", "journals:manage"], undefined]) {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions } });
      const res = await POST();
      expect({ permissions, status: res.status }).toEqual({ permissions, status: 403 });
    }
    expect(mockUser).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("admin sistem (`*`) boleh", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("pemegang settings_security:manage boleh, dan barisnya untuk dirinya sendiri", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settings_security:manage"] } });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1" }) }));
  });
});
