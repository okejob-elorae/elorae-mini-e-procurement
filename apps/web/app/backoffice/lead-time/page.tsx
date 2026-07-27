import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { LeadTimePageClient } from "./LeadTimePageClient";

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
  const tab =
    params.tab === "papan" || params.tab === "sop" ? params.tab : "pustaka";
  const canManage = hasPermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);

  return <LeadTimePageClient initialTab={tab} canManage={canManage} />;
}
