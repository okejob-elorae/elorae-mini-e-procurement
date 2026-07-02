import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src";

describe("seed: stores permissions", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates stores:view permission", async () => {
    const p = await prisma.permission.findUnique({ where: { code: "stores:view" } });
    expect(p).not.toBeNull();
    expect(p?.module).toBe("stores");
    expect(p?.action).toBe("view");
  });

  it("creates stores:manage permission", async () => {
    const p = await prisma.permission.findUnique({ where: { code: "stores:manage" } });
    expect(p).not.toBeNull();
    expect(p?.module).toBe("stores");
    expect(p?.action).toBe("manage");
  });

  it("links both permissions to the admin role", async () => {
    const adminRole = await prisma.roleDefinition.findUnique({ where: { name: "ADMIN" } });
    expect(adminRole).not.toBeNull();

    const links = await prisma.rolePermission.findMany({
      where: {
        roleId: adminRole!.id,
        permission: { code: { in: ["stores:view", "stores:manage"] } },
      },
      include: { permission: true },
    });
    const codes = links.map(l => l.permission.code).sort();
    expect(codes).toEqual(["stores:manage", "stores:view"]);
  });
});
