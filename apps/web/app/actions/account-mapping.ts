"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import { setAccountMapping } from "@/lib/finance/journals/mapping";

export type SetAccountMappingResult =
  | { ok: true }
  | { ok: false; code: "FORBIDDEN" | "BAD_ROLE" | "NON_POSTABLE_ACCOUNT" };

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

  await setAccountMapping(role, chartAccountId, prisma);

  revalidatePath("/backoffice/finance/account-mapping");
  return { ok: true };
}
