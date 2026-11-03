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
   * Same any-of entry as the register (and `canReadShipments` in the actions): the actor who closes
   * a delivery holds `deliveries:pod` without `deliveries:ship`, and Admin Penjualan holds only
   * `deliveries:cancel_nota` (P41a) while every register row links here. This page is read-only,
   * so it admits all three.
   */
  const canView =
    hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_POD) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_CANCEL_NOTA);
  if (!session?.user?.id || !canView) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const shipment = await getDeliveryShipmentDetail(id);
  if (!shipment) notFound();

  return <ShipmentDetailClient shipment={shipment} />;
}
