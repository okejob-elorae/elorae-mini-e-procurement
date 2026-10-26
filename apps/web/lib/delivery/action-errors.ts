import { DeliveryShipmentError, type DeliveryShipmentErrorCode } from "@/lib/delivery/errors";
import { DeliveryError, type DeliveryErrorCode } from "@/lib/field-sales/errors";
import { serializeReplay, type SerializedReplay } from "@/lib/field-sales/replay-detail";

/**
 * `DeliveryErrorCode` is in here because a putus completion calls straight through to
 * `recordFieldSalesDelivery`, which throws `DeliveryError` — a DIFFERENT class from
 * `DeliveryShipmentError` — for OVER_DELIVER, INSUFFICIENT_STOCK, INVALID_DATES, NO_LINES,
 * REPLAY_MISMATCH (a retry whose quantities — or, on an EXPEDITION shipment, dates — differ from
 * the delivery already recorded under the shipment's key; `completeDeliveryShipment` raises it
 * itself for an all-zero retry) and
 * RESERVATION_MISMATCH (the line's reservation disagrees with its recorded deliveries), and the
 * konsi completion maps a main-stock floor refusal onto the same `DeliveryError`
 * INSUFFICIENT_STOCK. Those are reachable through ordinary operator sequences (two shipments
 * claiming one order line, a stock-out between packing and delivery, a retry after a lost
 * response), not rare edge cases. The two unions overlap on NOT_FOUND / INVALID_STATE / NO_LINES,
 * which is fine — a union dedupes.
 */
export type ShipmentActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "UNEXPECTED"
  | DeliveryShipmentErrorCode
  | DeliveryErrorCode;

export type ShipmentActionResult =
  | { ok: true }
  | { ok: false; reason: ShipmentActionReason; replay?: SerializedReplay };

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
): { ok: false; reason: ShipmentActionReason; replay?: SerializedReplay } {
  if (error instanceof DeliveryShipmentError) return { ok: false, reason: error.code };
  if (error instanceof DeliveryError) {
    return error.replay
      ? { ok: false, reason: error.code, replay: serializeReplay(error.replay) }
      : { ok: false, reason: error.code };
  }
  console.error(`[${tag}] unexpected failure`, error);
  return { ok: false, reason: "UNEXPECTED" };
}
