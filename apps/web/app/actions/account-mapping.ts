"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import { setAccountMapping, clearAccountMapping, AccountTypeMismatchError } from "@/lib/finance/journals/mapping";
import { isAccountTypeValidForRole } from "@/lib/finance/journals/role-account-types";
import type { AccountType } from "@/lib/constants/enums";

export type SetAccountMappingResult =
  | { ok: true }
  | { ok: false; code: "FORBIDDEN" | "BAD_ROLE" | "NON_POSTABLE_ACCOUNT" | "WRONG_ACCOUNT_TYPE" };

function isPostingRole(role: string): role is PostingRole {
  return (POSTING_ROLES as readonly string[]).includes(role);
}

export async function setAccountMappingAction(
  role: string,
  chartAccountId: string,
): Promise<SetAccountMappingResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  if (!isPostingRole(role)) {
    return { ok: false, code: "BAD_ROLE" };
  }

  // Postable = active leaf (not the parentId of any other account) — mirrors
  // apps/web/lib/finance/coa/queries.ts getPostableAccounts.
  const account = await prisma.chartAccount.findUnique({ where: { id: chartAccountId } });
  if (!account || !account.isActive) {
    return { ok: false, code: "NON_POSTABLE_ACCOUNT" };
  }
  const hasChildren = await prisma.chartAccount.findFirst({ where: { parentId: account.id } });
  if (hasChildren) {
    return { ok: false, code: "NON_POSTABLE_ACCOUNT" };
  }

  if (!isAccountTypeValidForRole(role, account.type as AccountType)) {
    return { ok: false, code: "WRONG_ACCOUNT_TYPE" };
  }

  try {
    await setAccountMapping(role, chartAccountId, prisma);
  } catch (err) {
    /*
     * The pre-check above already covers this in the normal flow — this
     * only guards against the writer's own type check (which cannot be
     * bypassed) firing for a reason the pre-check missed.
     */
    if (err instanceof AccountTypeMismatchError) {
      return { ok: false, code: "WRONG_ACCOUNT_TYPE" };
    }
    throw err;
  }

  revalidatePath("/backoffice/finance/account-mapping");
  return { ok: true };
}

export async function clearAccountMappingAction(role: string): Promise<SetAccountMappingResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  if (!isPostingRole(role)) {
    return { ok: false, code: "BAD_ROLE" };
  }

  await clearAccountMapping(role, prisma);

  revalidatePath("/backoffice/finance/account-mapping");
  return { ok: true };
}
