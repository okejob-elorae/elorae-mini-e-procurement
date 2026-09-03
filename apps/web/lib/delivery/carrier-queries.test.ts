import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listCarrierCandidates } from "./carrier-queries";

/**
 * Same prod guard every other spec in this repo that writes live `User`/`RoleDefinition` rows
 * carries (see `lib/finance/collections/assign-writer.test.ts`). This file creates a real
 * non-system role and a real user, and an ambient `DATABASE_URL` pointed at the 3307 prod tunnel
 * would put both in the client's database.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * `connectOrCreate`, not a `findUnique` + assert: `deliveries:pod` has never been seeded anywhere
 * in this repo (no `seed-*-permissions.sql` counterpart exists for it), so asserting the row
 * already exists made this file's only positive test die in its own setup — never reaching
 * `listCarrierCandidates()` at all, while reading as two passing tests. The fixture creates
 * whatever is missing and reuses whatever is already there, so it is correct on a freshly seeded
 * bed and on prod-shaped data alike. Not torn down: a `Permission` row is shared reference data,
 * and deleting one this spec may not have created would strip it from real roles.
 */
const podPermission = {
  connectOrCreate: {
    where: { code: "deliveries:pod" },
    create: { code: "deliveries:pod", module: "deliveries", action: "pod" },
  },
};
const pwaPermission = {
  connectOrCreate: {
    where: { code: "pwa:access" },
    create: { code: "pwa:access", module: "pwa", action: "access" },
  },
};

d("listCarrierCandidates (test bed only)", () => {
  let roleId = "";
  let userId = "";

  beforeEach(async () => {
    roleId = userId = "";
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.roleDefinition.deleteMany({ where: { id: seededId(roleId) } });
  });

  it("returns users whose role holds both deliveries:pod and pwa:access", async () => {
    const role = await prisma.roleDefinition.create({
      data: {
        name: `carrier-test-role-${Date.now()}`,
        isSystem: false,
        permissions: {
          create: [{ permission: podPermission }, { permission: pwaPermission }],
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
    const role = await prisma.roleDefinition.create({
      data: {
        name: `non-carrier-role-${Date.now()}`,
        isSystem: false,
        permissions: { create: [{ permission: pwaPermission }] },
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
