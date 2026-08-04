import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { buildIncomeStatement } from "@/lib/finance/reports/income-statement";
import { IncomeStatementClient } from "./IncomeStatementClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function IncomeStatementPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const to = parseDateOnlyEnd(sp.to ?? "") ?? new Date();
  const from = parseDateOnly(sp.from ?? "");

  const balances = await getAccountBalances({ from, to });
  const report = buildIncomeStatement(balances);

  return (
    <IncomeStatementClient report={report} filters={{ from: sp.from ?? "", to: sp.to ?? "" }} />
  );
}
