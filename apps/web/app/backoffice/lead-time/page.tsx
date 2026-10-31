import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { LeadTimePageClient, type TabKey } from "./LeadTimePageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function LeadTimePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW)) {
    redirect("/backoffice");
  }

  const params = await searchParams;
  const tab: TabKey =
    params.tab === "papan" || params.tab === "sop" || params.tab === "hari-kerja" ? params.tab : "pustaka";
  const canManage = hasPermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
  // Kalender kerja produksi dipakai jadwal tahap: tim plan kerja juga boleh mengaturnya.
  const bolehAturKalender =
    canManage || hasPermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);

  return <LeadTimePageClient initialTab={tab} canManage={canManage} bolehAturKalender={bolehAturKalender} />;
}
