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
