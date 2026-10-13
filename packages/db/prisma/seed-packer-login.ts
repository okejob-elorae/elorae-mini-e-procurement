/**
 * Additive packer login seeder for production (or any existing DB).
 *
 * - Upserts packer:* Permission rows
 * - Upserts PACKER RoleDefinition + RolePermission links (also ADMIN convention links)
 * - Upserts a packer User with roleId → PACKER
 * - NEVER truncates
 *
 * Run (from repo root, with DATABASE_URL aimed at the target DB):
 *   pnpm -F @elorae/db seed:packer-login
 *
 * Env overrides:
 *   PACKER_EMAIL              default packer@elorae.com
 *   PACKER_PASSWORD           default packer123
 *   PACKER_PIN                default 123456
 *   SEED_PACKER_RESET_PASSWORD=1  also reset password/PIN on an existing user
 *
 * For RBAC-only (no User), hand-run prisma/seed-packer-role-permissions.sql instead.
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";

loadDbEnv();

const databaseUrl = (getDatabaseUrl() || process.env.DATABASE_URL || "").replace(
  /^mysql:\/\//i,
  "mariadb://",
);
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Add it to apps/web/.env (or packages/db/.env).",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

const PACKER_PERMS = [
  {
    code: "packer:menu",
    module: "packer",
    action: "menu",
    description: "Access Record Packer menu and list",
  },
  {
    code: "packer:record",
    module: "packer",
    action: "record",
    description: "Record packing videos",
  },
  {
    code: "packer:edit",
    module: "packer",
    action: "edit",
    description: "Replace existing packing videos",
  },
] as const;

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^mariadb:/i, "https:")).host;
  } catch {
    return "(unparseable)";
  }
}

async function main() {
  const email = (process.env.PACKER_EMAIL || "packer@elorae.com").trim().toLowerCase();
  const password = process.env.PACKER_PASSWORD || "packer123";
  const pin = process.env.PACKER_PIN || "123456";
  const resetPassword = process.env.SEED_PACKER_RESET_PASSWORD === "1";

  if (password.length < 6) {
    throw new Error("PACKER_PASSWORD must be at least 6 characters");
  }

  console.log("Seeding packer login (additive — no truncate)…");
  console.log(`  target: ${hostOf(databaseUrl)}`);
  console.log(`  email:  ${email}`);

  const permissionMap = new Map<string, { id: string; code: string }>();
  for (const perm of PACKER_PERMS) {
    const row = await prisma.permission.upsert({
      where: { code: perm.code },
      update: {
        module: perm.module,
        action: perm.action,
        description: perm.description,
      },
      create: {
        code: perm.code,
        module: perm.module,
        action: perm.action,
        description: perm.description,
      },
      select: { id: true, code: true },
    });
    permissionMap.set(row.code, row);
  }
  console.log(`Permissions OK (${permissionMap.size})`);

  const packerRole = await prisma.roleDefinition.upsert({
    where: { name: "PACKER" },
    update: {
      description: "Packer — Record Packer video packing surface",
      isSystem: false,
    },
    create: {
      name: "PACKER",
      description: "Packer — Record Packer video packing surface",
      isSystem: false,
    },
  });

  const adminRole = await prisma.roleDefinition.findUnique({
    where: { name: "ADMIN" },
    select: { id: true },
  });

  for (const code of PACKER_PERMS.map((p) => p.code)) {
    const perm = permissionMap.get(code);
    if (!perm) continue;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: packerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: { roleId: packerRole.id, permissionId: perm.id },
    });
    if (adminRole) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }
  }

  // Bump so already-logged-in sessions pick up new grants without re-login.
  await prisma.roleDefinition.update({
    where: { id: packerRole.id },
    data: { permissionsVersion: { increment: 1 } },
  });
  if (adminRole) {
    await prisma.roleDefinition.update({
      where: { id: adminRole.id },
      data: { permissionsVersion: { increment: 1 } },
    });
  }
  console.log("PACKER role + permissions OK");

  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = await bcrypt.hash(pin, 10);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleId: packerRole.id,
        role: Role.USER,
        ...(resetPassword ? { passwordHash, pinHash } : {}),
      },
    });
    console.log(
      resetPassword
        ? `Updated existing user ${email} (role + password/PIN reset).`
        : `Updated existing user ${email} (role only; set SEED_PACKER_RESET_PASSWORD=1 to reset password/PIN).`,
    );
  } else {
    await prisma.user.create({
      data: {
        email,
        name: "Packer",
        passwordHash,
        pinHash,
        role: Role.USER,
        roleId: packerRole.id,
      },
    });
    console.log(`Created user ${email}.`);
  }

  console.log("Done.");
  console.log(`Login: ${email} / ${password} (PIN: ${pin})`);
  console.log("Post-login lands on /packer when packer:menu is present.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
