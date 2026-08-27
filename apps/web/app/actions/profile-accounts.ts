"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/constants/enums";

export type AccountListItem = {
  id: string;
  name: string | null;
  email: string;
  roleId: string | null;
  roleName: string | null;
  hasPin: boolean;
};

export type RoleOption = {
  id: string;
  name: string;
  isSystem: boolean;
};

export type AccountActionResult =
  | { ok: true; id?: string }
  | { ok: false; code: string };

const LEGACY_ROLE_NAMES = new Set(["ADMIN", "PURCHASER", "WAREHOUSE", "PRODUCTION"]);

function legacyRoleFromDefinitionName(name: string): Role {
  if (LEGACY_ROLE_NAMES.has(name)) {
    return name as Role;
  }
  return "USER";
}

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, code: "unauthorized" as const, session: null };
  }
  if (session.user.role !== "ADMIN") {
    return { ok: false as const, code: "forbidden" as const, session: null };
  }
  return { ok: true as const, code: null, session };
}

function revalidateProfileAccounts() {
  revalidatePath("/backoffice/profile-accounts");
}

export async function listAccounts(): Promise<AccountListItem[] | { ok: false; code: string }> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      roleId: true,
      pinHash: true,
      roleDefinition: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: u.roleId,
    roleName: u.roleDefinition?.name ?? null,
    hasPin: Boolean(u.pinHash),
  }));
}

export async function listRoleOptions(): Promise<RoleOption[] | { ok: false; code: string }> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  return prisma.roleDefinition.findMany({
    select: { id: true, name: true, isSystem: true },
    orderBy: { name: "asc" },
  });
}

export async function getAccount(
  userId: string,
): Promise<AccountListItem | { ok: false; code: string }> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      roleId: true,
      pinHash: true,
      roleDefinition: { select: { name: true } },
    },
  });
  if (!user) return { ok: false, code: "userNotFound" };

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    roleName: user.roleDefinition?.name ?? null,
    hasPin: Boolean(user.pinHash),
  };
}

async function resolveRole(
  roleId: string,
): Promise<
  | { ok: true; legacyRole: Role }
  | { ok: false; code: string }
> {
  const role = await prisma.roleDefinition.findUnique({
    where: { id: roleId },
    select: { id: true, name: true },
  });
  if (!role) return { ok: false, code: "roleNotFound" };

  return {
    ok: true,
    legacyRole: legacyRoleFromDefinitionName(role.name),
  };
}

export async function createAccount(input: {
  name: string;
  email: string;
  password: string;
  roleId: string;
}): Promise<AccountActionResult> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";

  if (!name) return { ok: false, code: "nameRequired" };
  if (!email) return { ok: false, code: "emailRequired" };
  if (!password) return { ok: false, code: "passwordRequired" };
  if (password.length < 6) return { ok: false, code: "passwordMinLength" };
  if (!input.roleId) return { ok: false, code: "roleRequired" };

  const resolved = await resolveRole(input.roleId);
  if (!resolved.ok) return resolved;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return { ok: false, code: "emailTaken" };

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: resolved.legacyRole,
      roleId: input.roleId,
    },
    select: { id: true },
  });

  revalidateProfileAccounts();
  return { ok: true, id: created.id };
}

export async function updateAccount(input: {
  userId: string;
  name: string;
  roleId: string;
}): Promise<AccountActionResult> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, code: "nameRequired" };
  if (!input.roleId) return { ok: false, code: "roleRequired" };

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!user) return { ok: false, code: "userNotFound" };

  const resolved = await resolveRole(input.roleId);
  if (!resolved.ok) return resolved;

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      name,
      role: resolved.legacyRole,
      roleId: input.roleId,
    },
  });

  revalidateProfileAccounts();
  return { ok: true, id: input.userId };
}

export async function adminResetPassword(
  targetUserId: string,
  newPassword: string,
): Promise<AccountActionResult> {
  const gate = await requireAdminSession();
  if (!gate.ok) return { ok: false, code: gate.code };

  if (!newPassword?.trim()) return { ok: false, code: "passwordRequired" };
  if (newPassword.length < 6) return { ok: false, code: "passwordMinLength" };

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });
  if (!user) return { ok: false, code: "userNotFound" };

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash },
  });

  revalidateProfileAccounts();
  return { ok: true };
}
