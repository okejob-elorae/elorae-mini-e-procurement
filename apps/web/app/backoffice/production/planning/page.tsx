import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { PlanningPageClient } from "./PlanningPageClient";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_VIEW)) {
    redirect("/backoffice/dashboard");
  }

  return <PlanningPageClient />;
}
