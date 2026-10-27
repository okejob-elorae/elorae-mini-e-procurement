import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ItemRequestsClient } from "./ItemRequestsClient";

export default async function ItemRequestsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.ITEM_REQUESTS_VIEW)) redirect("/backoffice");

  return (
    <ItemRequestsClient
      userId={session.user.id}
      canManage={hasPermission(perms, PERMISSIONS.ITEM_REQUESTS_MANAGE)}
      canCreatePo={hasPermission(perms, PERMISSIONS.PURCHASE_ORDERS_CREATE)}
    />
  );
}
