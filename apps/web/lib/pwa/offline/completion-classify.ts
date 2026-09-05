export type CompletionSyncDecision = "evict" | "terminal" | "retry";

/**
 * Deliberately exhaustive over the FULL `ShipmentActionReason` union (both
 * `DeliveryShipmentErrorCode` and `DeliveryErrorCode`, per `app/actions/delivery-shipments.ts`),
 * not just the subset this flow can reach today — an unlisted code silently defaults to
 * "retry" below, which for a genuinely permanent server-side refusal means an infinite
 * retry loop that never surfaces to anyone. `MISSING_RESI` is EXPEDITION-only and this
 * queue only ever completes SALESMAN_CARRY shipments, but it's listed anyway so adding a
 * future shared code to the writer doesn't silently fall through here.
 *
 * FORBIDDEN and UNEXPECTED are deliberately RETRY here, unlike every other classifier in
 * this codebase (classify.ts, photo-classify.ts) — those flows have a human watching who
 * can re-authenticate by hand. This queue runs unattended in the background; a session
 * that expired mid-queue must wait for the salesman's next login and the next automatic
 * flush, not silently discard a completed delivery's evidence.
 */
const TERMINAL = new Set([
  "NOT_FOUND",
  "INVALID_STATE",
  "OVER_PLANNED",
  "LINE_MISMATCH",
  "INVALID_QTY",
  "NO_LINES",
  "NOT_CARRIER",
  "MISSING_PROOF",
  "MISSING_NOTA_PHOTO",
  "MISSING_SIGNED_BY",
  "MISSING_GPS",
  "STORE_NOT_GEOCODED",
  "GPS_OUT_OF_RADIUS",
  "MISSING_DATES",
  "MISSING_CARRIER",
  "MISSING_RESI",
  "OVER_DELIVER",
  "INSUFFICIENT_STOCK",
  "INVALID_DATES",
  "INVALID_REQUEST",
]);

export function classifyCompletionResult(
  r: { ok: true } | { ok: false; reason: string } | { thrown: true },
): CompletionSyncDecision {
  if ("thrown" in r) return "retry";
  if (r.ok) return "evict";
  if (r.reason === "FORBIDDEN" || r.reason === "UNEXPECTED") return "retry";
  return TERMINAL.has(r.reason) ? "terminal" : "retry";
}
