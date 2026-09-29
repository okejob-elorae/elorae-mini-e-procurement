import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getDeliveryShipmentDetail } from "@/lib/delivery/shipment-queries";
import { ShipmentDetailClient } from "./ShipmentDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ShipmentDetailPage({ params }: PageProps) {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  /**
   * Same either-permission entry as the register: the actor who closes a delivery holds
   * `deliveries:pod` without `deliveries:ship`, and this page is read-only, so it admits both.
   */
  const canView =
    hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_POD);
  if (!session?.user?.id || !canView) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const shipment = await getDeliveryShipmentDetail(id);
  if (!shipment) notFound();

  return <ShipmentDetailClient shipment={shipment} />;
}
