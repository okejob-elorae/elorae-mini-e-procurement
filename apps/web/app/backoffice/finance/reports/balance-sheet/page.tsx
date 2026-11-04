import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnlyEnd, endOfTodayJakarta, formatDateOnlyJakarta } from "@/lib/date-only";
import { muatNeraca } from "@/lib/finance/reports/neraca-queries";
import { BalanceSheetClient } from "./BalanceSheetClient";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ asOf?: string; nol?: string }>;
};

export default async function BalanceSheetPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const asOf = parseDateOnlyEnd(sp.asOf ?? "") ?? endOfTodayJakarta();

  const [{ report, openingWarningDate, earliest }, kesiapan] = await Promise.all([
    muatNeraca(asOf),
    bacaKesiapanBukuBesar(),
  ]);

  return (
    <BalanceSheetClient
      report={report}
      openingWarningDate={openingWarningDate}
      filters={{ asOf: sp.asOf ?? "", nol: sp.nol === "1" }}
      tanggalPosisi={formatDateOnlyJakarta(asOf)}
      adaJurnal={earliest != null && earliest.date.getTime() <= asOf.getTime()}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
    />
  );
}
