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
import { DeliveryError, type DeliveryErrorCode } from "@/lib/field-sales/errors";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";

/**
 * `DeliveryErrorCode` is in here because completion calls straight through to
 * `recordFieldSalesDelivery`, which throws `DeliveryError` — a DIFFERENT class from
 * `DeliveryShipmentError` — for OVER_DELIVER, INSUFFICIENT_STOCK, INVALID_DATES and NO_LINES.
 * Those are reachable through ordinary operator sequences (two shipments claiming one order line,
 * a stock-out between packing and delivery), not rare edge cases. The two unions overlap on
 * NOT_FOUND / INVALID_STATE / NO_LINES, which is fine — a union dedupes.
 */
export type ShipmentActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "UNEXPECTED"
  | DeliveryShipmentErrorCode
  | DeliveryErrorCode;

export type ShipmentActionResult = { ok: true } | { ok: false; reason: ShipmentActionReason };

/**
 * Every failure leaves as a mapped `reason` the dialogs can render. Rethrowing anything — which
 * this used to do for everything that was not a `DeliveryShipmentError` — surfaces in production
 * as a digest-masked server-action crash: the operator sees nothing at all, and the dialog sits
 * there. The stack still reaches the container logs via `console.error`, so nothing is lost by
 * not rethrowing; none of these actions call `redirect()`/`notFound()`, so there is no Next
 * control-flow error to swallow here.
 *
 * Not exported for the same reason `canReadShipments` below is not: a `"use server"` module may
 * only export async functions, and this is a plain sync helper. `app/pwa/deliveries/actions.ts`
 * reimplements this exact body (importing `DeliveryShipmentError`/`DeliveryError` directly)
 * rather than importing it — keep the two in sync by hand if either error class gains a case.
 */
function mapError(error: unknown): { ok: false; reason: ShipmentActionReason } {
  if (error instanceof DeliveryShipmentError) return { ok: false, reason: error.code };
  if (error instanceof DeliveryError) return { ok: false, reason: error.code };
  console.error("[delivery-shipments] unexpected failure", error);
  return { ok: false, reason: "UNEXPECTED" };
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
    return mapError(error);
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
  /**
   * Both dates are validated HERE, before the writer, not left to the writer's own guard. A server
   * action is a network endpoint, so an emptied or malformed field is not a client-side problem —
   * and an Invalid Date defeats the downstream ordering check rather than tripping it.
   */
  const invoiceDate = parseCalendarDay(input.invoiceDate);
  const dueDate = parseCalendarDay(input.dueDate);
  if (!invoiceDate || !dueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (dueDate.getTime() < invoiceDate.getTime()) {
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
