import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listShipmentsAction } from "@/app/actions/delivery-shipments";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { DeliveriesPageClient } from "./DeliveriesPageClient";

export default async function DeliveriesPage() {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    redirect("/backoffice");
  }

  const initial = await listShipmentsAction({ page: 1, pageSize: DEFAULT_PAGE_SIZE });

  return <DeliveriesPageClient initialItems={initial.items} initialTotal={initial.total} />;
}
