import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockAuth,
  mockUserFindUnique,
  mockUserCreate,
  mockUserUpdate,
  mockUserCount,
  mockRoleFindUnique,
  mockStoreFindUnique,
  mockRevalidatePath,
  mockBcryptHash,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserCount: vi.fn(),
  mockRoleFindUnique: vi.fn(),
  mockStoreFindUnique: vi.fn(),
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
      count: mockUserCount,
    },
    roleDefinition: {
      findUnique: mockRoleFindUnique,
      findMany: vi.fn(),
    },
    store: {
      findUnique: mockStoreFindUnique,
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

  it("creates an SPG with an active assigned store", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue({ id: "store-1", isActive: true });
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "new-3" });

    const r = await createAccount({
      name: "Spg",
      email: "spg@x.com",
      password: "secret1",
      roleId: "role-spg",
      assignedStoreId: "store-1",
    });

    expect(r).toEqual({ ok: true, id: "new-3" });
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedStoreId: "store-1" }),
      }),
    );
  });

  it("refuses an SPG whose store does not exist", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue(null);

    const r = await createAccount({
      name: "Spg",
      email: "spg@x.com",
      password: "secret1",
      roleId: "role-spg",
      assignedStoreId: "store-x",
    });

    expect(r).toEqual({ ok: false, code: "storeNotFound" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("refuses an SPG whose store is inactive", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue({ id: "store-1", isActive: false });

    const r = await createAccount({
      name: "Spg",
      email: "spg@x.com",
      password: "secret1",
      roleId: "role-spg",
      assignedStoreId: "store-1",
    });

    expect(r).toEqual({ ok: false, code: "storeInactive" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("refuses a store on a non-SPG role", async () => {
    mockRoleFindUnique.mockResolvedValue({ id: "role-sales", name: "SALESMAN" });

    const r = await createAccount({
      name: "Sam",
      email: "sam@x.com",
      password: "secret1",
      roleId: "role-sales",
      assignedStoreId: "store-1",
    });

    expect(r).toEqual({ ok: false, code: "storeOnlyForSpg" });
    expect(mockUserCreate).not.toHaveBeenCalled();
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

  it("updates name and role for a non-admin user", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "u-1", role: "USER" });
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
        assignedStoreId: null,
      },
    });
  });

  it("assigns a new active store when the role is SPG", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: null,
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue({ id: "store-1", isActive: true });
    mockUserUpdate.mockResolvedValue({});

    const r = await updateAccount({
      userId: "u-1",
      name: "Spg",
      roleId: "role-spg",
      assignedStoreId: "store-1",
    });

    expect(r).toEqual({ ok: true, id: "u-1" });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: {
        name: "Spg",
        role: "USER",
        roleId: "role-spg",
        assignedStoreId: "store-1",
      },
    });
  });

  it("allows keeping an SPG's current store after it went inactive", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: "store-old",
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue({ id: "store-old", isActive: false });
    mockUserUpdate.mockResolvedValue({});

    const r = await updateAccount({
      userId: "u-1",
      name: "Spg",
      roleId: "role-spg",
      assignedStoreId: "store-old",
    });

    expect(r).toEqual({ ok: true, id: "u-1" });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedStoreId: "store-old" }),
      }),
    );
  });

  it("refuses moving an SPG onto an inactive store", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: "store-old",
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockStoreFindUnique.mockResolvedValue({ id: "store-2", isActive: false });

    const r = await updateAccount({
      userId: "u-1",
      name: "Spg",
      roleId: "role-spg",
      assignedStoreId: "store-2",
    });

    expect(r).toEqual({ ok: false, code: "storeInactive" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("leaves the store unchanged for an SPG when the field is omitted", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: "store-old",
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockUserUpdate.mockResolvedValue({});

    await updateAccount({ userId: "u-1", name: "Spg", roleId: "role-spg" });

    const call = mockUserUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("assignedStoreId");
  });

  it("clears the store for an SPG when null is sent", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: "store-old",
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-spg", name: "SPG" });
    mockUserUpdate.mockResolvedValue({});

    await updateAccount({
      userId: "u-1",
      name: "Spg",
      roleId: "role-spg",
      assignedStoreId: null,
    });

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedStoreId: null }),
      }),
    );
  });

  it("refuses a store on a non-SPG role", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u-1",
      role: "USER",
      assignedStoreId: null,
    });
    mockRoleFindUnique.mockResolvedValue({ id: "role-sales", name: "SALESMAN" });

    const r = await updateAccount({
      userId: "u-1",
      name: "Sam",
      roleId: "role-sales",
      assignedStoreId: "store-1",
    });

    expect(r).toEqual({ ok: false, code: "storeOnlyForSpg" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("refuses demoting the last ADMIN", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "u-1", role: "ADMIN" });
    mockRoleFindUnique.mockResolvedValue({
      id: "role-sales",
      name: "SALESMAN",
    });
    mockUserCount.mockResolvedValue(1);

    const r = await updateAccount({
      userId: "u-1",
      name: "Only Admin",
      roleId: "role-sales",
    });
    expect(r).toEqual({ ok: false, code: "lastAdmin" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
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
