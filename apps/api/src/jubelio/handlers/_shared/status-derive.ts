import type { SalesOrderStatus } from "@elorae/db";

export type RawStatusInput = {
  is_canceled?: boolean | null;
  internal_status?: string | null;
  marked_as_complete?: boolean | null;
  completed_date?: string | null;
  wms_status?: string | null;
  is_shipped?: boolean | null;
};

const PROCESSING_WMS = new Set(["PROCESSING", "PICKED", "PACKED", "READY_TO_PACK", "READY_TO_SHIP"]);

/**
 * The one definition of "Jubelio cancelled this order". Jubelio often reports a cancel through
 * `internal_status: "CANCELED"` alone and leaves `is_canceled` false, so reading the flag by itself
 * misses those cancels. The derived `status` keys on this, and the reservation release keys on it
 * together with `isReturnedOrder`.
 */
export function isCanceledOrder(p: Pick<RawStatusInput, "is_canceled" | "internal_status">): boolean {
  return p.is_canceled === true || p.internal_status === "CANCELED";
}

/**
 * The one definition of "Jubelio reports this order returned". A returned order is finished: the
 * salesorder handler releases whatever it still holds RESERVED and never reserves it, unless
 * Jubelio also reports it shipped, in which case the consume branch runs first. Until cutover
 * Jubelio's own figure governs on-hand, so a finished order's stale reservation is dropped rather
 * than consumed late. The SalesReturn mirror keys on this too.
 */
export function isReturnedOrder(p: Pick<RawStatusInput, "internal_status" | "wms_status">): boolean {
  return p.internal_status === "RETURNED" || p.wms_status === "RETURNED";
}

/**
 * The one definition of "Jubelio reports this order has left the warehouse", short of completion.
 * Jubelio now signals a ship almost only through `internal_status: "SHIPPED"`, usually with
 * `wms_status` still at READY_TO_SHIP; `wms_status: "SHIPPED"` has all but stopped arriving, so
 * keying on it alone leaves a shipped order RESERVED until it completes days later. The derived
 * `status` keys on this, and the salesorder handler's consume and fulfillment sync key on it
 * together with the completion signals.
 */
export function isShippedOrder(
  p: Pick<RawStatusInput, "internal_status" | "wms_status" | "is_shipped">,
): boolean {
  return p.wms_status === "SHIPPED" || p.is_shipped === true || p.internal_status === "SHIPPED";
}

export function deriveStatus(p: RawStatusInput): SalesOrderStatus {
  if (isCanceledOrder(p)) return "CANCELLED";
  // Returned takes precedence over completed/shipped: returns happen AFTER ship.
  if (isReturnedOrder(p)) return "RETURNED";
  if (p.marked_as_complete === true || p.internal_status === "COMPLETED" || p.completed_date) {
    return "COMPLETED";
  }
  if (isShippedOrder(p)) return "SHIPPED";
  if ((p.wms_status && PROCESSING_WMS.has(p.wms_status)) || p.internal_status === "PROCESSING") {
    return "PROCESSING";
  }
  return "NEW";
}
