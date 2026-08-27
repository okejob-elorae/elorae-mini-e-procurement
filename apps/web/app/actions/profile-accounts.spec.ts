import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockAuth,
  mockUserFindUnique,
  mockUserCreate,
  mockUserUpdate,
  mockRoleFindUnique,
  mockRevalidatePath,
  mockBcryptHash,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockRoleFindUnique: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockBcryptHash: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("bcryptjs", () => ({
  default: {
    hash: mockBcryptHash,
    compare: vi.fn(),
  },
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      findMany: vi.fn(),
      create: mockUserCreate,
      update: mockUserUpdate,
    },
    roleDefinition: {
      findUnique: mockRoleFindUnique,
      findMany: vi.fn(),
    },
  },
}));

import {
  createAccount,
  updateAccount,
  adminResetPassword,
} from "./profile-accounts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN", permissions: ["*"] },
};
const purchaserSession = {
  user: { id: "u-2", role: "PURCHASER", permissions: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  mockBcryptHash.mockResolvedValue("hashed");
  mockAuth.mockResolvedValue(adminSession);
});

describe("createAccount", () => {
  it("refuses non-admin", async () => {
    mockAuth.mockResolvedValue(purchaserSession);
    const r = await createAccount({
      name: "A",
      email: "a@x.com",
      password: "secret1",
      roleId: "role-1",
    });
    expect(r).toEqual({ ok: false, code: "forbidden" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("creates SPG with legacy USER role and no store field", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "new-1" });

    const r = await createAccount({
      name: "Spg",
      email: "spg@x.com",
      password: "secret1",
      roleId: "role-spg",
    });

    expect(r).toEqual({ ok: true, id: "new-1" });
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: {
        name: "Spg",
        email: "spg@x.com",
        passwordHash: "hashed",
        role: "USER",
        roleId: "role-spg",
      },
      select: { id: true },
    });
  });

  it("syncs legacy ADMIN when RoleDefinition is ADMIN", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-admin", name: "ADMIN" });
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "new-2" });

    const r = await createAccount({
      name: "Boss",
      email: "boss@x.com",
      password: "secret1",
      roleId: "role-admin",
    });

    expect(r).toEqual({ ok: true, id: "new-2" });
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ADMIN",
        }),
      }),
    );
  });
});

describe("updateAccount", () => {
  it("refuses non-admin", async () => {
    mockAuth.mockResolvedValue(purchaserSession);
    const r = await updateAccount({
      userId: "u-1",
      name: "X",
      roleId: "role-1",
    });
    expect(r).toEqual({ ok: false, code: "forbidden" });
  });

  it("updates name and role without touching assignedStoreId", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "u-1" });
    mockRoleFindUnique.mockResolvedValue({
      id: "role-sales",
      name: "SALESMAN",
    });
    mockUserUpdate.mockResolvedValue({});

    const r = await updateAccount({
      userId: "u-1",
      name: "Sam",
      roleId: "role-sales",
    });

    expect(r).toEqual({ ok: true, id: "u-1" });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: {
        name: "Sam",
        role: "USER",
        roleId: "role-sales",
      },
    });
  });
});

describe("adminResetPassword", () => {
  it("refuses non-admin", async () => {
    mockAuth.mockResolvedValue(purchaserSession);
    const r = await adminResetPassword("u-1", "secret1");
    expect(r).toEqual({ ok: false, code: "forbidden" });
  });

  it("hashes and updates password for admin", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "u-1" });
    mockUserUpdate.mockResolvedValue({});
    const r = await adminResetPassword("u-1", "secret1");
    expect(r).toEqual({ ok: true });
    expect(mockBcryptHash).toHaveBeenCalledWith("secret1", 10);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { passwordHash: "hashed" },
    });
  });
});
