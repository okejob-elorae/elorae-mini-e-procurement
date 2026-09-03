import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listShipmentsAction } from "@/app/actions/delivery-shipments";
import { listStoreOptions } from "@/lib/stores/queries";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { DeliveriesPageClient } from "./DeliveriesPageClient";

export default async function DeliveriesPage() {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  const canShip = hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP);
  const canPod = hasPermission(permissions, PERMISSIONS.DELIVERIES_POD);
  /**
   * EITHER permission opens the route. `deliveries:pod` exists for the actor who closes a
   * delivery against proof, and completion is only reachable from this register — gating entry on
   * `deliveries:ship` alone redirected that actor away from the one page they need. Each ACTION
   * inside still checks its own permission, and the Complete button is gated on `canPod` below,
   * so a ship-only user no longer sees a button that would 403 on submit.
   */
  if (!session?.user?.id || (!canShip && !canPod)) {
    redirect("/backoffice");
  }

  const [initial, storeOptions] = await Promise.all([
    listShipmentsAction({ page: 1, pageSize: DEFAULT_PAGE_SIZE }),
    listStoreOptions(),
  ]);

  return (
    <DeliveriesPageClient
      initialItems={initial.items}
      initialTotal={initial.total}
      storeOptions={storeOptions}
      canShip={canShip}
      canPod={canPod}
    />
  );
}
