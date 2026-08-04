import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { buildTrialBalance } from "@/lib/finance/reports/trial-balance";
import { TrialBalanceClient } from "./TrialBalanceClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string; zero?: string }>;
};

export default async function TrialBalancePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const to = parseDateOnlyEnd(sp.to ?? "") ?? new Date();
  const from = parseDateOnly(sp.from ?? "");
  const includeZero = sp.zero === "1";

  const balances = await getAccountBalances({ from, to });
  const report = buildTrialBalance(balances, { includeZero });

  return (
    <TrialBalanceClient
      report={report}
      filters={{ from: sp.from ?? "", to: sp.to ?? "", zero: includeZero }}
    />
  );
}
