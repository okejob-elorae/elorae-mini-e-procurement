"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
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
import { mapError, type ShipmentActionReason, type ShipmentActionResult } from "@/lib/delivery/action-errors";
import { DeliveryError } from "@/lib/field-sales/errors";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";

export type { ShipmentActionReason, ShipmentActionResult };

const ERROR_TAG = "delivery-shipments";

/**
 * Revalidates the order detail page a shipment belongs to. The writer's return carries no order
 * id, so it is looked up here, after the write has committed; a failed lookup is logged and
 * swallowed because the write already succeeded and the register path is revalidated regardless.
 */
async function revalidateShipmentOrder(shipmentId: string): Promise<void> {
  try {
    const shipment = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: { orderId: true },
    });
    if (shipment) revalidatePath(`/backoffice/field-sales-orders/${shipment.orderId}`);
  } catch (error) {
    console.error(`[${ERROR_TAG}] order revalidation lookup failed`, error);
  }
}

/**
 * Both of a PUTUS delivery's journals, through `postArJournalSafely` — never a builder called bare.
 * The success path and the `REPLAY_MISMATCH` refusal share it, so the two cannot drift apart.
 * Posting is idempotent on the source document, so a delivery whose journals already posted
 * re-posts nothing. Never exported: from a `"use server"` module that would publish it as a
 * network-callable action posting journals for any delivery id, which is also why
 * `app/pwa/deliveries/actions.ts` holds its own copy — keep the two in sync by hand.
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
 * READ access to the shipment register. Not exported — a `"use server"` module may only export
 * async functions, so the server page spells the same OR out with `hasPermission` directly.
 */
function canReadShipments(permissions: string[]): boolean {
  return (
    hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_POD)
  );
}

/**
 * A `YYYY-MM-DD` calendar day at WIB midnight, or null for anything that is not one. Same shape
 * and same three rejections as `parseCalendarDay` in `app/actions/field-sales-deliveries.ts`: a
 * non-string (a JSON number survives into `.trim()` and throws), a value `new Date` silently rolls
 * over (`"2026-02-30"` → 2 March, and it would be STORED), and a year outside MariaDB's `DATETIME`
 * range. The format round-trip is what closes the last two.
 *
 * Without this, `new Date(\`${input.invoiceDate}T00:00:00.000+07:00\`)` on an emptied date field
 * produces an Invalid Date, `recordFieldSalesDelivery`'s own ordering guard evaluates
 * `NaN < NaN === false` and therefore PASSES it, and the Invalid Date reaches a Prisma write.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
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
    return mapError(error, ERROR_TAG);
  }
}

export async function updateShipmentTrackingAction(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
  carriedById?: string;
  invoiceDate?: string;
  dueDate?: string;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const invoiceDate = input.invoiceDate ? parseCalendarDay(input.invoiceDate) : undefined;
  const dueDate = input.dueDate ? parseCalendarDay(input.dueDate) : undefined;
  if ((input.invoiceDate && !invoiceDate) || (input.dueDate && !dueDate)) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  /**
   * Same ordering check `completeShipmentAction` applies below, but conditional on both dates
   * actually being supplied — they are optional on this action, which is also how a carrier is
   * saved on its own without touching the dates. This is the ONLY place a reversed pair can still
   * be caught: `updateShipmentTracking` is PACKED-gated, so once the shipment ships the pair is
   * frozen, and the salesman then discovers it in the field with no way to correct it. The
   * SALESMAN_CARRY completion path reads these dates off the row and never revalidates them.
   */
  if (invoiceDate && dueDate && dueDate.getTime() < invoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }
  try {
    await updateShipmentTracking({
      shipmentId: input.shipmentId,
      carrierName: input.carrierName,
      resiNumber: input.resiNumber,
      carriedById: input.carriedById,
      invoiceDate: invoiceDate ?? undefined,
      dueDate: dueDate ?? undefined,
    });
    revalidatePath("/backoffice/deliveries");
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
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
    await revalidateShipmentOrder(input.shipmentId);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

export async function completeShipmentAction(input: {
  shipmentId: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  invoiceDate?: string;
  dueDate?: string;
  lines: Array<{ shipmentLineId: string; deliveredQty: number }>;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  /**
   * Both dates are validated HERE when supplied, before the writer, not left to the writer's own
   * guard. A server action is a network endpoint, so an emptied or malformed field is not a
   * client-side problem — and an Invalid Date defeats the downstream ordering check rather than
   * tripping it. Optional now: a konsi order raises no invoice and the dialog sends neither date,
   * which parses to `undefined` on both — `completeDeliveryShipment`'s own konsi branch never asks
   * for them, and its non-konsi branch still throws MISSING_DATES if either is absent.
   */
  const invoiceDate = input.invoiceDate ? parseCalendarDay(input.invoiceDate) : undefined;
  const dueDate = input.dueDate ? parseCalendarDay(input.dueDate) : undefined;
  /* null means supplied-but-malformed, undefined means absent; `=== null` also narrows both to `Date | undefined`. */
  if (invoiceDate === null || dueDate === null) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (invoiceDate && dueDate && dueDate.getTime() < invoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }

  try {
    const result = await completeDeliveryShipment({
      shipmentId: input.shipmentId,
      deliveredById: session.user.id,
      proofPhotoUrl: input.proofPhotoUrl,
      proofPhotoR2Key: input.proofPhotoR2Key,
      invoiceDate,
      dueDate,
      lines: input.lines,
    });

    /**
     * Posted AFTER completeDeliveryShipment's transaction commits, exactly the same placement
     * recordDeliveryAction uses for a hand-entered delivery — see
     * app/actions/field-sales-deliveries.ts. completeDeliveryShipment itself stays a pure DB
     * writer with no journal-posting side effect, same as recordFieldSalesDelivery.
     *
     * result.deliveryId is "" for a KONSI order — completeDeliveryShipment's konsi branch moves
     * the stock itself through a KonsiTransfer inside its own transaction and never calls
     * recordFieldSalesDelivery, because a konsi transfer is a stock move, not a sale, and has no
     * delivery document or journal — guard on it being non-empty or these post against a delivery
     * that doesn't exist.
     */
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);

    revalidatePath("/backoffice/deliveries");
    await revalidateShipmentOrder(input.shipmentId);
    return { ok: true };
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "REPLAY_MISMATCH" && error.replay) {
      /**
       * The refused replay's delivery is REAL — recorded under this shipment's key, stock moved,
       * receivable raised — and a crash before the posts above means its journals never posted.
       * The shipment stays IN_TRANSIT, so only a resubmit with the recorded quantities would reach
       * that success path, and nothing guarantees one ever comes. Posted here, before the refusal
       * goes back; `replay.deliveryId` is never "" (a konsi completion records no delivery).
       */
      await postDeliveryJournals(error.replay.deliveryId, session.user.id);
    }
    return mapError(error, ERROR_TAG);
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
    await revalidateShipmentOrder(input.shipmentId);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

/**
 * The register itself is readable by EITHER permission, for the same reason `getShipmentAction`
 * is: the POD actor reaches the Complete button by finding the IN_TRANSIT row in this list, so a
 * `deliveries:ship`-only gate here would hand them an empty page and nothing to complete. Every
 * WRITE stays on its own permission — `deliveries:ship` for pack/track/ship/cancel,
 * `deliveries:pod` for completion.
 */
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
  if (!session?.user?.id || !canReadShipments(session.user.permissions ?? [])) {
    return { items: [], total: 0 };
  }
  return listDeliveryShipments({
    ...input,
    dateFrom: input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000+07:00`) : undefined,
    dateTo: input.dateTo ? new Date(`${input.dateTo}T23:59:59.999+07:00`) : undefined,
  });
}

/**
 * EITHER permission, unlike every other action in this file. `completeShipmentAction` requires
 * `deliveries:pod`, and the completion dialog cannot populate its per-line quantities without
 * first loading the shipment through here — gating this on `deliveries:ship` alone left a
 * POD-only actor, the exact role the permission was created for, unable to complete anything.
 */
export async function getShipmentAction(id: string) {
  const session = await auth();
  if (!session?.user?.id || !canReadShipments(session.user.permissions ?? [])) {
    return null;
  }
  return getDeliveryShipment(id);
}
