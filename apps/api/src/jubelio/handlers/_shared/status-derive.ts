import type { SalesOrderStatus } from "@elorae/db";

export type RawStatusInput = {
  is_canceled?: boolean | null;
  internal_status?: string | null;
  marked_as_complete?: boolean | null;
  completed_date?: string | null;
  wms_status?: string | null;
  is_shipped?: boolean | null;
};

const PROCESSING_WMS = new Set(["PROCESSING", "PICKED", "PACKED", "READY_TO_PACK"]);

/**
 * The one definition of "Jubelio cancelled this order". Jubelio often reports a cancel through
 * `internal_status: "CANCELED"` alone and leaves `is_canceled` false, so reading the flag by itself
 * misses those cancels. Both the derived `status` and the reservation release key on this.
 */
export function isCanceledOrder(p: Pick<RawStatusInput, "is_canceled" | "internal_status">): boolean {
  return p.is_canceled === true || p.internal_status === "CANCELED";
}

/**
 * The one definition of "Jubelio reports this order returned". A returned order is finished, so
 * the salesorder handler releases whatever it still holds RESERVED — it never consumes it, since
 * the goods either never left or came back — and the SalesReturn mirror keys on it too.
 */
export function isReturnedOrder(p: Pick<RawStatusInput, "internal_status" | "wms_status">): boolean {
  return p.internal_status === "RETURNED" || p.wms_status === "RETURNED";
}

export function deriveStatus(p: RawStatusInput): SalesOrderStatus {
  if (isCanceledOrder(p)) return "CANCELLED";
  // Returned takes precedence over completed/shipped: returns happen AFTER ship.
  if (isReturnedOrder(p)) return "RETURNED";
  if (p.marked_as_complete === true || p.internal_status === "COMPLETED" || p.completed_date) {
    return "COMPLETED";
  }
  if (p.wms_status === "SHIPPED" || p.is_shipped === true) return "SHIPPED";
  if ((p.wms_status && PROCESSING_WMS.has(p.wms_status)) || p.internal_status === "PROCESSING") {
    return "PROCESSING";
  }
  return "NEW";
}
