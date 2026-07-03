import { describe, it, expect } from "vitest";
import { prisma } from "../src";

describe("seed — PWA scaffold", () => {
  it("pwa:access Permission exists", async () => {
    const perm = await prisma.permission.findUnique({ where: { code: "pwa:access" } });
    expect(perm).not.toBeNull();
    expect(perm?.module).toBe("pwa");
    expect(perm?.action).toBe("access");
  });

  it("SALESMAN role exists and has pwa:access permission", async () => {
    const role = await prisma.roleDefinition.findUnique({
      where: { name: "SALESMAN" },
      include: { permissions: { include: { permission: true } } },
    });
    expect(role).not.toBeNull();
    const codes = role!.permissions.map((rp) => rp.permission.code);
    expect(codes).toContain("pwa:access");
  });

  it("salesman@elorae.com user exists and is assigned to SALESMAN role", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "salesman@elorae.com" },
      include: { roleDefinition: true },
    });
    expect(user).not.toBeNull();
    expect(user!.roleDefinition?.name).toBe("SALESMAN");
  });
});
