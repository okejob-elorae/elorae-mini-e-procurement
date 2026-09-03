"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
  cancelDeliveryShipment,
} from "@/lib/delivery/shipment-writer";
import { listDeliveryShipments, getDeliveryShipment } from "@/lib/delivery/shipment-queries";
import { DeliveryShipmentError, type DeliveryShipmentErrorCode } from "@/lib/delivery/errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";

export type ShipmentActionResult =
  | { ok: true }
  | { ok: false; reason: "FORBIDDEN" | DeliveryShipmentErrorCode };

function mapError(error: unknown): ShipmentActionResult {
  if (error instanceof DeliveryShipmentError) return { ok: false, reason: error.code };
  throw error;
}

export async function createShipmentAction(input: {
  orderId: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  lines: Array<{ orderLineId: string; qty: number }>;
}): Promise<ShipmentActionResult & { shipmentId?: string }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    const result = await createDeliveryShipment({ ...input, packedById: session.user.id });
    revalidatePath("/backoffice/deliveries");
    revalidatePath(`/backoffice/field-sales-orders/${input.orderId}`);
    return { ok: true, shipmentId: result.shipmentId };
  } catch (error) {
    return mapError(error);
  }
}

export async function updateShipmentTrackingAction(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    await updateShipmentTracking(input);
    revalidatePath("/backoffice/deliveries");
    return { ok: true };
  } catch (error) {
    return mapError(error);
  }
}

export async function shipShipmentAction(input: { shipmentId: string }): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    await shipDeliveryShipment({ shipmentId: input.shipmentId, shippedById: session.user.id });
    revalidatePath("/backoffice/deliveries");
    return { ok: true };
  } catch (error) {
    return mapError(error);
  }
}

export async function completeShipmentAction(input: {
  shipmentId: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  invoiceDate: string;
  dueDate: string;
  lines: Array<{ shipmentLineId: string; deliveredQty: number }>;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    const result = await completeDeliveryShipment({
      shipmentId: input.shipmentId,
      deliveredById: session.user.id,
      proofPhotoUrl: input.proofPhotoUrl,
      proofPhotoR2Key: input.proofPhotoR2Key,
      invoiceDate: new Date(`${input.invoiceDate}T00:00:00.000+07:00`),
      dueDate: new Date(`${input.dueDate}T00:00:00.000+07:00`),
      lines: input.lines,
    });

    /**
     * Posted AFTER completeDeliveryShipment's transaction commits, exactly the same placement
     * recordDeliveryAction uses for a hand-entered delivery — see
     * app/actions/field-sales-deliveries.ts. completeDeliveryShipment itself stays a pure DB
     * writer with no journal-posting side effect, same as recordFieldSalesDelivery.
     *
     * result.deliveryId is "" for a KONSI order (completeDeliveryShipment's own konsi branch
     * skips recordFieldSalesDelivery entirely, since KonsiTransfer already moved stock at
     * approve) — guard on it being non-empty or these post against a delivery that doesn't
     * exist.
     */
    if (result.deliveryId) {
      await postArJournalSafely("field_delivery_revenue", result.deliveryId, () =>
        postFieldDeliveryRevenueJournal(result.deliveryId, session.user.id),
      );
      await postArJournalSafely("field_delivery_cogs", result.deliveryId, () =>
        postFieldDeliveryCogsJournal(result.deliveryId, session.user.id),
      );
    }

    revalidatePath("/backoffice/deliveries");
    return { ok: true };
  } catch (error) {
    return mapError(error);
  }
}

export async function cancelShipmentAction(input: { shipmentId: string }): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    await cancelDeliveryShipment({ shipmentId: input.shipmentId, cancelledById: session.user.id });
    revalidatePath("/backoffice/deliveries");
    return { ok: true };
  } catch (error) {
    return mapError(error);
  }
}

export async function listShipmentsAction(input: {
  status?: "PACKED" | "IN_TRANSIT" | "DELIVERED" | "PARTIALLY_DELIVERED" | "CANCELLED";
  method?: "EXPEDITION" | "SALESMAN_CARRY";
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}) {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { items: [], total: 0 };
  }
  return listDeliveryShipments({
    ...input,
    dateFrom: input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000+07:00`) : undefined,
    dateTo: input.dateTo ? new Date(`${input.dateTo}T23:59:59.999+07:00`) : undefined,
  });
}

export async function getShipmentAction(id: string) {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return null;
  }
  return getDeliveryShipment(id);
}
