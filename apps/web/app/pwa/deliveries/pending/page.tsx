import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { PendingCompletionsClient } from "./PendingCompletionsClient";

export default async function PendingDeliveryCompletionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) redirect("/pwa");
  return <PendingCompletionsClient />;
}
