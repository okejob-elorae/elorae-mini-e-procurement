import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { MovementsPageClient } from "./MovementsPageClient";

export const dynamic = "force-dynamic";

export default async function StockMovementsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) redirect("/backoffice");

  return <MovementsPageClient />;
}
