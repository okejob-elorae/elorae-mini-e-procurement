import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ItemImportPageClient } from "./ItemImportPageClient";

export const dynamic = "force-dynamic";

export default async function ItemImportPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.ITEMS_CREATE)) redirect("/backoffice/items");
  return <ItemImportPageClient />;
}
