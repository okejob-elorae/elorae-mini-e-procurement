import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/firebase/admin", () => ({ messaging: { send: vi.fn() } }));

import { getUsersWithPermission } from "./recipients";

describe("getUsersWithPermission with a missing Permission row", () => {
  let token = "";
  let systemRoleId = "";
  let plainRoleId = "";
  let systemUserId = "";
  let plainUserId = "";

  beforeEach(async () => {
    token = "";
    systemRoleId = "";
    plainRoleId = "";
    systemUserId = "";
    plainUserId = "";
    token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const systemRole = await prisma.roleDefinition.create({
      data: { name: `rcpt-sys-${token}`, isSystem: true },
    });
    systemRoleId = systemRole.id;
    const plainRole = await prisma.roleDefinition.create({
      data: { name: `rcpt-plain-${token}`, isSystem: false },
    });
    plainRoleId = plainRole.id;
    const systemUser = await prisma.user.create({
      data: { email: `rcpt-sys-${token}@example.test`, roleId: systemRoleId },
    });
    systemUserId = systemUser.id;
    const plainUser = await prisma.user.create({
      data: { email: `rcpt-plain-${token}@example.test`, roleId: plainRoleId },
    });
    plainUserId = plainUser.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [seededId(systemUserId), seededId(plainUserId)] } } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: [seededId(systemRoleId), seededId(plainRoleId)] } } });
  });

  it("still returns system-role users, and not a plain-role user", async () => {
    const code = `never-existing:${token}`;
    expect(await prisma.permission.findUnique({ where: { code } })).toBeNull();
    const users = await getUsersWithPermission(code);
    const ids = users.map((u) => u.id);
    expect(ids).toContain(systemUserId);
    expect(ids).not.toContain(plainUserId);
  });
});
