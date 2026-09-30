"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { completeDeliveryShipment } from "@/lib/delivery/shipment-writer";
import { listMyDeliveries } from "@/lib/delivery/shipment-queries";
import { DeliveryShipmentError } from "@/lib/delivery/errors";
import { DeliveryError } from "@/lib/field-sales/errors";
import { serializeReplay, type SerializedReplay } from "@/lib/field-sales/replay-detail";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import type { ShipmentActionResult, ShipmentActionReason } from "@/app/actions/delivery-shipments";

/**
 * Identical body to `mapError` in `@/app/actions/delivery-shipments` — reimplemented here
 * rather than imported because that one is a plain sync helper inside a `"use server"` module,
 * which may only export async functions, so it is not exported. Keep both in sync by hand if
 * either `DeliveryShipmentError` or `DeliveryError` gains a new code.
 */
function mapError(error: unknown): { ok: false; reason: ShipmentActionReason; replay?: SerializedReplay } {
  if (error instanceof DeliveryShipmentError) return { ok: false, reason: error.code };
  if (error instanceof DeliveryError) {
    return error.replay
      ? { ok: false, reason: error.code, replay: serializeReplay(error.replay) }
      : { ok: false, reason: error.code };
  }
  console.error("[pwa/deliveries] unexpected failure", error);
  return { ok: false, reason: "UNEXPECTED" };
}

/**
 * Same body as `postDeliveryJournals` in `@/app/actions/delivery-shipments`: both of a PUTUS
 * delivery's journals through `postArJournalSafely`, shared by the success path and the
 * `REPLAY_MISMATCH` refusal. Duplicated rather than imported because exporting it from either
 * `"use server"` module would publish it as a network-callable action that posts journals for any
 * delivery id. Keep the two in sync by hand.
 */
async function postDeliveryJournals(deliveryId: string, postedById: string): Promise<void> {
  await postArJournalSafely("field_delivery_revenue", deliveryId, () =>
    postFieldDeliveryRevenueJournal(deliveryId, postedById),
  );
  await postArJournalSafely("field_delivery_cogs", deliveryId, () =>
    postFieldDeliveryCogsJournal(deliveryId, postedById),
  );
}

export async function listMyDeliveriesAction(): Promise<
  Array<{
    id: string;
    docNo: string;
    storeName: string;
    orderNo: string;
    plannedTotalQty: number;
  }>
> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) {
    return [];
  }
  return listMyDeliveries(session.user.id);
}

/**
 * No `revalidatePath` here on purpose — the PWA has no cached path that needs it, and the PWA
 * list page re-fetches on its own next load. If the backoffice deliveries list ever needs to
 * reflect a PWA completion without a manual refresh, add
 * `revalidatePath("/backoffice/deliveries")`, but the two surfaces are used by different actors
 * who are not looking at the same screen simultaneously in the common case.
 */
export async function completePodAction(input: {
  shipmentId: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  gps: { lat: number; lng: number };
  signatureUrl?: string;
  signatureR2Key?: string;
  signedByName?: string;
  deliveredAt?: Date;
  completedOffline?: boolean;
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
      gps: input.gps,
      signatureUrl: input.signatureUrl,
      signatureR2Key: input.signatureR2Key,
      signedByName: input.signedByName,
      deliveredAt: input.deliveredAt,
      completedOffline: input.completedOffline,
      lines: input.lines,
    });

    /**
     * Same placement and same guard `completeShipmentAction` uses in
     * `@/app/actions/delivery-shipments` — posted AFTER `completeDeliveryShipment`'s transaction
     * commits, guarded on `result.deliveryId` being non-empty (it is `""` for a KONSI order,
     * whose completion never creates a `FieldSalesDelivery`). Without this, every PUTUS delivery
     * completed through the PWA would create a `FieldSalesDelivery` + `Receivable` with no GL
     * entry and no repair path.
     */
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);

    return { ok: true };
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "REPLAY_MISMATCH" && error.replay) {
      /**
       * Same reasoning as `completeShipmentAction`: the refused replay's delivery is real and its
       * journals may never have posted, so they post here before the refusal goes back. It
       * matters most on this path — the offline queue classifies REPLAY_MISMATCH as terminal and
       * never resubmits.
       */
      await postDeliveryJournals(error.replay.deliveryId, session.user.id);
    }
    return mapError(error);
  }
}

const STUCK_REASON_PATTERN = /^[A-Z_]{1,64}$/;

/**
 * Called by the unattended offline queue, so it takes no permission: a revoked `deliveries:pod`
 * is exactly one of the failures it must still report. The binding is to the shipment instead —
 * only its assigned carrier may raise the alert, and a shipment that is missing, not
 * SALESMAN_CARRY or someone else's resolves silently (the queue then stops re-reporting it).
 * The reason is an error code from the queue; anything else is recorded as `UNKNOWN` rather than
 * copied into an admin-facing message.
 */
export async function reportStuckDeliveryCompletionAction(
  shipmentId: string,
  reason: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  if (typeof shipmentId !== "string" || !shipmentId) return;
  const shipment = await prisma.deliveryShipment.findUnique({
    where: { id: shipmentId },
    select: { docNo: true, method: true, carriedById: true },
  });
  if (!shipment || shipment.method !== "SALESMAN_CARRY" || shipment.carriedById !== session.user.id) return;
  const code = typeof reason === "string" && STUCK_REASON_PATTERN.test(reason) ? reason : "UNKNOWN";
  const recent = await prisma.adminNotification.findMany({
    where: { category: "DELIVERY_COMPLETION_STUCK", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  const alreadyFlagged = recent.some((n) => {
    const m = n.metadata as { shipmentId?: string; reason?: string } | null;
    return m?.shipmentId === shipmentId && m?.reason === code;
  });
  if (alreadyFlagged) return;
  const notification = await prisma.adminNotification.create({
    data: {
      category: "DELIVERY_COMPLETION_STUCK",
      severity: "WARNING",
      title: "Salesman-carry delivery completion failed to sync",
      message: `Shipment ${shipment.docNo} could not be completed: ${code}. Evidence (photos, GPS, receiver name) has been captured — check the offline queue on the salesman's device or contact them directly.`,
      metadata: { shipmentId, reason: code, docNo: shipment.docNo },
    },
  });
  await fanOutAdminNotification(notification).catch(() => {});
}
