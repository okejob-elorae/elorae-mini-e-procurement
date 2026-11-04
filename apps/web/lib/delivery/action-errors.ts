import { ReservationReopenError } from "@elorae/db";
import { DeliveryShipmentError, type DeliveryShipmentErrorCode } from "@/lib/delivery/errors";
import { DeliveryError, type DeliveryErrorCode } from "@/lib/field-sales/errors";
import { KonsiTransferNotInTransitError } from "@/lib/field-sales/konsi-transfer/writer";
import { serializeReplay, type SerializedReplay } from "@/lib/field-sales/replay-detail";

/**
 * `DeliveryErrorCode` is in here because a putus shipment CREATION calls straight through to
 * `recordFieldSalesDeliveryInTx` (the nota is issued when the shipment is created), which throws
 * `DeliveryError` — a DIFFERENT class from `DeliveryShipmentError` — for OVER_DELIVER,
 * INSUFFICIENT_STOCK, INVALID_DATES, NO_LINES and RESERVATION_MISMATCH (the line's reservation
 * disagrees with its recorded deliveries), and the konsi creation maps a main-stock floor refusal
 * onto the same `DeliveryError` INSUFFICIENT_STOCK. A door refusal or cancel that cannot reopen a
 * reservation (`ReservationReopenError`) also reads RESERVATION_MISMATCH. The two unions overlap on
 * NOT_FOUND / INVALID_STATE / NO_LINES, which is fine — a union dedupes. `detail` carries the
 * numbers a refusal names (payment reports, a kontrabon, a nota number, a receipt reason).
 */
export type ShipmentActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "UNEXPECTED"
  | DeliveryShipmentErrorCode
  | DeliveryErrorCode;

export type ShipmentActionResult =
  | { ok: true }
  | { ok: false; reason: ShipmentActionReason; detail?: string; replay?: SerializedReplay };

/**
 * Every failure leaves as a mapped `reason` the dialogs can render. Rethrowing anything surfaces
 * in production as a digest-masked server-action crash: the operator sees nothing at all, and the
 * dialog sits there. The stack still reaches the container logs via `console.error`, so nothing
 * is lost by not rethrowing; none of the shipment actions call `redirect()`/`notFound()`, so
 * there is no Next control-flow error to swallow here.
 *
 * Lives outside the `"use server"` modules because those may only export async functions; `tag`
 * is the caller's console prefix so a log line still says which surface failed.
 */
export function mapError(
  error: unknown,
  tag: string,
): { ok: false; reason: ShipmentActionReason; detail?: string; replay?: SerializedReplay } {
  if (error instanceof DeliveryShipmentError) {
    return error.detail ? { ok: false, reason: error.code, detail: error.detail } : { ok: false, reason: error.code };
  }
  /* A door refusal or cancel found the line's reservation already released or not drawn that far. */
  if (error instanceof ReservationReopenError) return { ok: false, reason: "RESERVATION_MISMATCH" };
  /* A concurrent receipt (RECEIVED) or cancel (CANCELLED) won the transfer first. */
  if (error instanceof KonsiTransferNotInTransitError) {
    return { ok: false, reason: error.status === "RECEIVED" ? "ALREADY_RECEIVED" : "INVALID_STATE" };
  }
  if (error instanceof DeliveryError) {
    return error.replay
      ? { ok: false, reason: error.code, replay: serializeReplay(error.replay) }
      : { ok: false, reason: error.code };
  }
  console.error(`[${tag}] unexpected failure`, error);
  return { ok: false, reason: "UNEXPECTED" };
}
