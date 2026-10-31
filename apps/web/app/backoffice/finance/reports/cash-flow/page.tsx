import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getCashFlowReport } from "@/app/actions/finance-reports";
import { CashFlowClient } from "./CashFlowClient";
import { aksesSpanduk, bacaKesiapanBukuBesar, hariIniWib } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function CashFlowPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const [report, kesiapan] = await Promise.all([
    getCashFlowReport({ from: sp.from, to: sp.to }),
    bacaKesiapanBukuBesar(),
  ]);

  return (
    <CashFlowClient
      report={report}
      filters={{ from: sp.from ?? "", to: sp.to ?? "" }}
      canManageJournals={hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)}
      hariIni={hariIniWib()}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
    />
  );
}
