import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getShipmentAction } from "@/app/actions/delivery-shipments";
import { CompletePodSheet } from "./CompletePodSheet";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ shipmentId: string }> };

export default async function CompletePodPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) redirect("/pwa");

  const { shipmentId } = await params;
  const shipment = await getShipmentAction(shipmentId);
  if (!shipment) notFound();
  /**
   * Fail fast on ownership. `getShipmentAction` deliberately admits EITHER `deliveries:ship` or
   * `deliveries:pod` (the backoffice register needs that), so it hands back ANY shipment to any
   * POD holder — which would render a fully interactive completion sheet for another salesman's
   * delivery, and only refuse at submit time after the photo and GPS were already captured.
   * `completeDeliveryShipment`'s `NOT_CARRIER` guard is the real enforcement; this is the
   * fail-fast half. `notFound()` rather than a message, matching the `!shipment` line above: a
   * shipment that is not yours should not be distinguishable from one that does not exist. Also
   * catches an EXPEDITION shipment reached through this route, whose `carriedById` is null.
   */
  if (shipment.carriedById !== session.user.id) notFound();

  return (
    <CompletePodSheet
      shipmentId={shipmentId}
      storeName={shipment.storeName}
      docNo={shipment.docNo}
      lines={shipment.lines.map((l) => ({
        id: l.id,
        productName: l.productName,
        plannedQty: l.plannedQty,
      }))}
    />
  );
}
