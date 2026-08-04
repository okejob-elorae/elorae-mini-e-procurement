import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances, getEarliestJournal } from "@/lib/finance/reports/balances";
import { buildBalanceSheet } from "@/lib/finance/reports/balance-sheet";
import { BalanceSheetClient } from "./BalanceSheetClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ asOf?: string }>;
};

export default async function BalanceSheetPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const asOf = parseDateOnlyEnd(sp.asOf ?? "") ?? new Date();

  const [balances, earliest] = await Promise.all([
    getAccountBalances({ to: asOf }),
    getEarliestJournal(),
  ]);
  const report = buildBalanceSheet(balances);

  /* A manual oldest journal is taken as the opening-balance entry, so no warning. */
  const openingWarningDate =
    earliest && !earliest.isManual ? earliest.date.toISOString() : null;

  return (
    <BalanceSheetClient
      report={report}
      openingWarningDate={openingWarningDate}
      filters={{ asOf: sp.asOf ?? "" }}
    />
  );
}
