import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getCoaTree } from "@/lib/finance/coa/queries";
import {
  attachRolledUpBalances,
  pruneInactiveForDisplay,
} from "@/lib/finance/coa/roll-up-balances";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { CoaPageClient } from "./CoaPageClient";

export const dynamic = "force-dynamic";

type SearchParams = { inactive?: string };

export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.COA_VIEW)) redirect("/backoffice");

  const params = await searchParams;
  const includeInactive = params.inactive === "1";
  // Always roll up on the full tree so hidden inactive leaves still contribute
  // to parent balances; prune only for display when inactive are hidden.
  const [fullTree, balanceRows] = await Promise.all([
    getCoaTree({ includeInactive: true }),
    getAccountBalances({ to: new Date() }),
  ]);
  const balanceById: Record<string, number> = {};
  for (const row of balanceRows) {
    balanceById[row.accountId] = row.signed;
  }
  const rolled = attachRolledUpBalances(fullTree, balanceById);
  const treeWithBalances = includeInactive
    ? rolled
    : pruneInactiveForDisplay(rolled);
  const canManage = hasPermission(perms, PERMISSIONS.COA_MANAGE);
  const canViewLedger = hasPermission(perms, PERMISSIONS.JOURNALS_VIEW);

  return (
    <CoaPageClient
      tree={treeWithBalances}
      includeInactive={includeInactive}
      canManage={canManage}
      canViewLedger={canViewLedger}
    />
  );
}
