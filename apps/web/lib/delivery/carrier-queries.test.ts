import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listCarrierCandidates } from "./carrier-queries";

describe("listCarrierCandidates", () => {
  let roleId = "";
  let userId = "";
  let permissionId = "";
  let pwaAccessPermissionId = "";

  beforeEach(async () => {
    roleId = userId = permissionId = pwaAccessPermissionId = "";
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.roleDefinition.deleteMany({ where: { id: seededId(roleId) } });
  });

  it("returns users whose role holds both deliveries:pod and pwa:access", async () => {
    const podPermission = await prisma.permission.findUnique({ where: { code: "deliveries:pod" } });
    const pwaPermission = await prisma.permission.findUnique({ where: { code: "pwa:access" } });
    expect(podPermission).not.toBeNull();
    expect(pwaPermission).not.toBeNull();

    const role = await prisma.roleDefinition.create({
      data: {
        name: `carrier-test-role-${Date.now()}`,
        isSystem: false,
        permissions: {
          create: [{ permissionId: podPermission!.id }, { permissionId: pwaPermission!.id }],
        },
      },
    });
    roleId = role.id;

    const user = await prisma.user.create({
      data: { name: "Carrier Candidate", email: `carrier-${Date.now()}@test.local`, roleId },
    });
    userId = user.id;

    const candidates = await listCarrierCandidates();
    expect(candidates.some((c) => c.id === userId)).toBe(true);
  });

  it("excludes a user whose role lacks deliveries:pod", async () => {
    const pwaPermission = await prisma.permission.findUnique({ where: { code: "pwa:access" } });
    const role = await prisma.roleDefinition.create({
      data: {
        name: `non-carrier-role-${Date.now()}`,
        isSystem: false,
        permissions: { create: [{ permissionId: pwaPermission!.id }] },
      },
    });
    roleId = role.id;
    const user = await prisma.user.create({
      data: { name: "Not A Carrier", email: `notcarrier-${Date.now()}@test.local`, roleId },
    });
    userId = user.id;

    const candidates = await listCarrierCandidates();
    expect(candidates.some((c) => c.id === userId)).toBe(false);
  });
});
