import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ReconciliationPageClient } from "./ReconciliationPageClient";

export const dynamic = "force-dynamic";

export default async function ForecastReconciliationPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions, PERMISSIONS.FORECAST_VIEW)) {
    redirect("/backoffice");
  }

  return <ReconciliationPageClient permissions={session.user.permissions} />;
}
