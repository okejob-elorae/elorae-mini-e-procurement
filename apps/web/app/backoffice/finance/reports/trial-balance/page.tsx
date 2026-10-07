import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd, endOfTodayJakarta } from "@/lib/date-only";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { buildTrialBalance } from "@/lib/finance/reports/trial-balance";
import { TrialBalanceClient } from "./TrialBalanceClient";
import { aksesSpanduk, bacaKesiapanBukuBesar, hariIniWib } from "../../_kesiapan/baca";

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
  const to = parseDateOnlyEnd(sp.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(sp.from ?? "");
  const includeZero = sp.zero === "1";

  const [balances, kesiapan] = await Promise.all([getAccountBalances({ from, to }), bacaKesiapanBukuBesar()]);
  const report = buildTrialBalance(balances, { includeZero });

  return (
    <TrialBalanceClient
      report={report}
      filters={{ from: sp.from ?? "", to: sp.to ?? "", zero: includeZero }}
      hariIni={hariIniWib()}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
    />
  );
}
