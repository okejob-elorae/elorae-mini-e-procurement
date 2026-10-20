import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getCommissionRecap, type CommissionRecap } from "@/lib/spg-commission/queries";
import { isYearMonth, wibYearMonth } from "@/lib/spg-commission/month";
import { SpgCommissionPageClient } from "./SpgCommissionPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function SpgCommissionPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");
  const canManageRates = hasPermission(perms, PERMISSIONS.SPG_COMMISSION_MANAGE);

  const sp = await searchParams;
  const currentMonth = wibYearMonth(new Date());
  /* A missing or malformed `?month=` falls back to the current WIB month rather than an error page. */
  const month = isYearMonth(sp.month) ? sp.month : currentMonth;

  let recap: CommissionRecap | null = null;
  try {
    recap = await getCommissionRecap(month);
  } catch (err) {
    /* The error card names no cause, so the container log is the only place the reason lands. */
    console.error("[spg-commission] recap query failed", err);
  }

  return (
    <SpgCommissionPageClient
      key={month}
      recap={recap}
      month={month}
      currentMonth={currentMonth}
      canManageRates={canManageRates}
    />
  );
}
