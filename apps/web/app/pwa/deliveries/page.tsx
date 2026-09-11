import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listMyDeliveries } from "@/lib/delivery/shipment-queries";
import { DeliveriesQueueList } from "./DeliveriesQueueList";

export const dynamic = "force-dynamic";

export default async function MyDeliveriesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) redirect("/pwa");

  const rows = await listMyDeliveries(session.user.id);

  return <DeliveriesQueueList rows={rows} />;
}
