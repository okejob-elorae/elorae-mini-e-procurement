import type { ShipmentActionReason } from "@/lib/delivery/action-errors";

export type CompletionSyncDecision = "evict" | "terminal" | "retry";

/** Every refusal except the two this unattended queue waits out (see below). */
type ReasonTerminal = Exclude<ShipmentActionReason, "FORBIDDEN" | "UNEXPECTED">;

/**
 * Deliberately exhaustive over the FULL `ShipmentActionReason` union (both
 * `DeliveryShipmentErrorCode` and `DeliveryErrorCode`, per `app/actions/delivery-shipments.ts`),
 * not just the subset this flow can reach today — an unlisted code silently defaults to
 * "retry" below, which for a genuinely permanent server-side refusal means an infinite
 * retry loop that never surfaces to anyone. `MISSING_RESI` is EXPEDITION-only and this
 * queue only ever completes SALESMAN_CARRY shipments, but it's listed anyway so adding a
 * future shared code to the writer doesn't silently fall through here. The same goes for the
 * codes only shipment creation, tracking, ship and cancel can return (cancel blockers, missing
 * weight or handover photo, a pre-order not released, a nota number taken, an ineligible
 * carrier): completion never reaches them today, but none of them clears on a retry either.
 *
 * A `Record` over the union, so a new member is a type error here; `apps/web` type-check rarely
 * runs, so `completion-classify.test.ts` also reads both unions from source and checks every
 * member is listed.
 *
 * FORBIDDEN and UNEXPECTED are deliberately RETRY here, unlike classify.ts — that flow has a
 * human watching who can re-authenticate by hand. (photo-classify.ts also retries a 401 now,
 * but still treats a 403 as terminal.) This queue runs unattended in the background; a session
 * that expired mid-queue must wait for the salesman's next login and the next automatic
 * flush, not silently discard a completed delivery's evidence.
 */
const TERMINAL_PER_KODE: Record<ReasonTerminal, true> = {
  NOT_FOUND: true,
  INVALID_STATE: true,
  OVER_PLANNED: true,
  LINE_MISMATCH: true,
  INVALID_QTY: true,
  NO_LINES: true,
  NOT_CARRIER: true,
  MISSING_PROOF: true,
  MISSING_NOTA_PHOTO: true,
  MISSING_SIGNED_BY: true,
  KONSI_NOT_RESERVED: true,
  KONSI_PESANAN_LAMA: true,
  NO_INVENTORY_ROW: true,
  MISSING_GPS: true,
  STORE_NOT_GEOCODED: true,
  GPS_OUT_OF_RADIUS: true,
  MISSING_DATES: true,
  MISSING_CARRIER: true,
  /* Tracking/reassign only: the named carrier is not an eligible user. */
  INVALID_CARRIER: true,
  MISSING_RESI: true,
  OVER_DELIVER: true,
  INSUFFICIENT_STOCK: true,
  INVALID_DATES: true,
  SHIPMENT_IN_FLIGHT: true,
  REPLAY_MISMATCH: true,
  RESERVATION_MISMATCH: true,
  INVALID_REQUEST: true,
  /* The store already received this shipment (its SPG, or a concurrent completion). */
  ALREADY_RECEIVED: true,
  /* Ship only: an expedition shipment leaves with its weight (P35) and handover photo (P43). */
  MISSING_WEIGHT: true,
  INVALID_WEIGHT: true,
  MISSING_HANDOVER_PHOTO: true,
  /* Cancel only: "tidak jadi dikirim" needs a reason, and a nota with a payment report, in a kontrabon or priced by a return stays. */
  REASON_REQUIRED: true,
  RECEIVABLE_PAID: true,
  RECEIVABLE_IN_USE: true,
  RETURN_PRICED: true,
  /* Creation only: a pre-order not released yet, or the nota number already taken. */
  INDEN_BELUM_RILIS: true,
  NOMOR_NOTA_DIPAKAI: true,
  /* Door refusals (`returnedQty`) that cannot be put back: the consume record is gone. */
  CONSUME_RECORD_MISSING: true,
  LINE_UNACCOUNTED: true,
  /* The store's SPG already recorded the receipt; the POD must not write a second one. */
  DICATAT_SPG: true,
  /* A completion that hands over nothing and refuses nothing. */
  POD_KOSONG: true,
  /* The store receipt written inside the completion refused its content. */
  TERIMA_GAGAL: true,
};

const TERMINAL: ReadonlySet<string> = new Set(Object.keys(TERMINAL_PER_KODE));

export function classifyCompletionResult(
  r: { ok: true } | { ok: false; reason: string } | { thrown: true },
): CompletionSyncDecision {
  if ("thrown" in r) return "retry";
  if (r.ok) return "evict";
  if (r.reason === "FORBIDDEN" || r.reason === "UNEXPECTED") return "retry";
  return TERMINAL.has(r.reason) ? "terminal" : "retry";
}
