"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { completeDeliveryShipment } from "@/lib/delivery/shipment-writer";
import { listMyDeliveries } from "@/lib/delivery/shipment-queries";
import { mapError, type ShipmentActionResult } from "@/lib/delivery/action-errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { kaitPindahKonsiPengiriman } from "@/lib/finance/operasional/kait";
import { kabarkanPengirimanDiserahkan } from "@/lib/spg/kabar-pengiriman";
import { sebarSesudahTerima } from "@/lib/spg/stok-writer";

const ERROR_TAG = "pwa/deliveries";

/**
 * Same body as `postDeliveryJournals` in `@/app/actions/delivery-shipments`: both of a PUTUS
 * delivery's journals through `postArJournalSafely`. Duplicated rather than imported because exporting it from either
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

/**
 * Same body as `notifyStoreSpg` in `@/app/actions/delivery-shipments`, duplicated for the same
 * reason as `postDeliveryJournals` above — keep the two in sync by hand. Tells the store's SPG the
 * goods of THIS shipment were handed over (count and receive them), putus and konsi alike, keyed
 * on the shipment; a 0-pcs completion says nothing was handed over. The notifier never throws and
 * notifies once per shipment.
 */
async function notifyStoreSpg(shipmentId: string, deliveryId: string, actorId: string): Promise<void> {
  void kabarkanPengirimanDiserahkan({ shipmentId, deliveryId: deliveryId || null, pelakuId: actorId });
}

/**
 * Same body as `postKonsiMoveJournal` in `@/app/actions/delivery-shipments` — keep the two in sync
 * by hand. The consignment move journal of a konsi shipment (posted at creation, re-synced after a
 * receipt at the POD); the hook is idempotent and never throws.
 */
async function postKonsiMoveJournal(shipmentId: string, actorId: string): Promise<void> {
  try {
    const shipment = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: { order: { select: { orderType: true } } },
    });
    if (shipment?.order.orderType !== "KONSI") return;
    await kaitPindahKonsiPengiriman(shipmentId, actorId);
  } catch (error) {
    console.error(`[${ERROR_TAG}] konsi move journal hook failed`, error);
  }
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
  lines: Array<{ shipmentLineId: string; deliveredQty: number; returnedQty?: number; lostQty?: number }>;
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
     * Same tail as `completeShipmentAction` in `@/app/actions/delivery-shipments`, after the
     * completion committed and also on a same-actor replay (every step is idempotent): the store
     * receipt's post-commit half when the POD was the receipt (a store without an SPG), the
     * journals of the nota or the konsi transfer, and the SPG notice.
     */
    if (result.podReceipt) {
      await sebarSesudahTerima({
        storeId: result.podReceipt.storeId,
        userId: session.user.id,
        sourceType: result.podReceipt.sourceType,
        receiptId: result.podReceipt.receiptId,
        sesudah: result.podReceipt.sesudah,
      });
    }
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);
    else await postKonsiMoveJournal(input.shipmentId, session.user.id);
    await notifyStoreSpg(input.shipmentId, result.deliveryId, session.user.id);

    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

const STUCK_REASON_PATTERN = /^[A-Z_]{1,64}$/;

/**
 * Called by the unattended offline queue, so it takes no permission: a revoked `deliveries:pod`
 * is exactly one of the failures it must still report. The binding is to the shipment instead —
 * only its assigned carrier may raise the alert, and a shipment that is missing, not
 * SALESMAN_CARRY or someone else's resolves silently (the queue then stops re-reporting it).
 * "Assigned carrier" includes a PREVIOUS one: after a reassign, that carrier's queued completion
 * dies terminally with `NOT_CARRIER`, and the alert is how an admin learns evidence was captured
 * for a delivery that has since moved, so a user named as `before.carriedById` on one of this
 * shipment's reassign audit rows is accepted too.
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
  if (!shipment || shipment.method !== "SALESMAN_CARRY") return;
  if (shipment.carriedById !== session.user.id) {
    /* The JSON column has no reliable path filter under the adapter, so match in code. */
    const reassigns = await prisma.auditLog.findMany({
      where: {
        action: "DELIVERY_SHIPMENT_CARRIER_REASSIGNED",
        entityType: "DeliveryShipment",
        entityId: shipmentId,
      },
      select: { changes: true },
    });
    const wasCarrier = reassigns.some((row) => {
      const changes = row.changes as { before?: { carriedById?: string | null } } | null;
      return changes?.before?.carriedById === session.user.id;
    });
    if (!wasCarrier) return;
  }
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
