import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { endOfTodayJakarta } from "@/lib/date-only";
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
  const canViewBalances = hasPermission(perms, PERMISSIONS.FINANCE_REPORTS_VIEW);

  // Always roll up on the full tree so hidden inactive leaves still contribute
  // to parent balances; prune only for display when inactive are hidden.
  const fullTree = await getCoaTree({ includeInactive: true });
  const balanceById: Record<string, number> = {};
  if (canViewBalances) {
    const balanceRows = await getAccountBalances({ to: endOfTodayJakarta() });
    for (const row of balanceRows) {
      balanceById[row.accountId] = row.signed;
    }
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
      showBalances={canViewBalances}
    />
  );
}
