import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit: pelaku pekerjaan tanpa orang dipilih dari PERAN SISTEM, tidak pernah dari
 * kolom peran lama `User.role`. Prisma ditirukan; yang dipasak adalah kueri yang
 * dikirim, karena salah kolom di sini tidak membuat apa pun gagal — cron hanya
 * memposting atas nama orang yang salah, atau tidak memposting sama sekali.
 */
const h = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@elorae/db", () => ({ prisma: { user: { findFirst: h.findFirst } } }));

import { adminSistemTertua, SYARAT_ADMIN_SISTEM } from "./admin-sistem";

beforeEach(() => {
  h.findFirst.mockReset();
});

describe("adminSistemTertua", () => {
  it("filters on the system role, never on the legacy role column", async () => {
    h.findFirst.mockResolvedValue({ id: "u-admin", email: "admin@uji.local" });

    await expect(adminSistemTertua()).resolves.toEqual({ id: "u-admin", email: "admin@uji.local" });

    const arg = h.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ roleDefinition: { isSystem: true } });
    expect(arg.where).not.toHaveProperty("role");
    expect(SYARAT_ADMIN_SISTEM).toEqual({ roleDefinition: { isSystem: true } });
  });

  it("picks the oldest admin, with the id as a tie-break so the choice is stable", async () => {
    h.findFirst.mockResolvedValue(null);
    await adminSistemTertua();
    expect(h.findFirst.mock.calls[0][0].orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("returns null when there is no system admin, so the caller can say so instead of guessing", async () => {
    h.findFirst.mockResolvedValue(null);
    await expect(adminSistemTertua()).resolves.toBeNull();
  });

  it("uses the client it is given (scripts pass their own)", async () => {
    const lain = vi.fn().mockResolvedValue({ id: "u-skrip", email: "skrip@uji.local" });
    await expect(adminSistemTertua({ user: { findFirst: lain } } as never)).resolves.toEqual({
      id: "u-skrip",
      email: "skrip@uji.local",
    });
    expect(lain).toHaveBeenCalledOnce();
    expect(h.findFirst).not.toHaveBeenCalled();
  });
});
