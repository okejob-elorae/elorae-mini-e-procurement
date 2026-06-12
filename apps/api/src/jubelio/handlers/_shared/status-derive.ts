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

export function deriveStatus(p: RawStatusInput): SalesOrderStatus {
  if (p.is_canceled === true || p.internal_status === "CANCELED") return "CANCELLED";
  if (p.marked_as_complete === true || p.internal_status === "COMPLETED" || p.completed_date) {
    return "COMPLETED";
  }
  if (p.wms_status === "SHIPPED" || p.is_shipped === true) return "SHIPPED";
  if ((p.wms_status && PROCESSING_WMS.has(p.wms_status)) || p.internal_status === "PROCESSING") {
    return "PROCESSING";
  }
  return "NEW";
}
