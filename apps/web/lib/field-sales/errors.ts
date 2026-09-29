export class NoActiveVisitError extends Error {
  constructor(public storeId: string, public salesmanId: string) {
    super("NO_ACTIVE_VISIT");
    this.name = "NoActiveVisitError";
  }
}
export type MinQtyViolation = { itemId: string; requiredMin: number; actualQty: number };
export class MinQtyViolationError extends Error {
  constructor(public violations: MinQtyViolation[]) {
    super("MIN_QTY_VIOLATION");
    this.name = "MinQtyViolationError";
  }
}
export class InvalidOrderTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super("INVALID_ORDER_TRANSITION");
    this.name = "InvalidOrderTransitionError";
  }
}
export type ShortLine = { itemId: string; variantSku: string; available: number };
export class InsufficientStockError extends Error {
  constructor(public shortLines: ShortLine[]) {
    super("INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
  }
}

export type InvalidAddedLineCode =
  | "UNKNOWN_ITEM"
  | "NO_INVENTORY"
  | "BAD_QTY"
  | "DUPLICATE"
  | "ALREADY_SENT"
  | "NOT_KONSI";

export class InvalidAddedLineError extends Error {
  constructor(
    public code: InvalidAddedLineCode,
    public itemId: string | null = null,
  ) {
    super(code);
    this.name = "InvalidAddedLineError";
  }
}

export type DeliveryErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "NO_LINES"
  | "OVER_DELIVER"
  | "INSUFFICIENT_STOCK"
  | "INVALID_DATES"
  /**
   * Close remainder refused while the order still has a PACKED or IN_TRANSIT delivery shipment.
   * Closing releases the whole line reservation, so the in-flight shipment would then complete
   * against nothing — KONSI_NOT_RESERVED for konsi, OVER_DELIVER for putus — with its goods
   * already on the truck. Complete or cancel the shipment first.
   */
  | "SHIPMENT_IN_FLIGHT"
  /**
   * A retry reused an idempotency key whose delivery was already recorded, but asked for something
   * different: different quantities, or different invoice/due dates — dates are compared for a
   * hand-entered delivery and an `EXPEDITION` shipment, but not for a `SALESMAN_CARRY` shipment,
   * whose `shipment-<id>` key compares quantities only; an all-zero shipment retry against a
   * recorded delivery is always a mismatch. The recorded delivery is left exactly as it was and
   * the recorded values ride on `DeliveryError.replay`. The operator resubmits with the recorded
   * values, or delivers any remaining quantity as a new delivery, and corrects the dates through
   * the delivery date-correction action.
   */
  | "REPLAY_MISMATCH"
  /**
   * The line's stock reservation cannot take this delivery: it is missing, no longer `RESERVED`
   * (released, or already consumed), or would be over-consumed — the reservation disagrees with
   * the deliveries recorded against the order. Not an operator quantity error, and a retry cannot
   * clear it. The most likely cause is the delivery-rollout deploy race (an order the old image
   * approved after the delivery backfill migration ran, consumed with no backfilled delivery); the
   * remedy is an admin repair of the order — for that race, the per-order hand-run of the backfill
   * migration's statements — before it can be delivered.
   */
  | "RESERVATION_MISMATCH";

export type DeliveryReplayDetail = {
  deliveryId: string;
  docNo: string;
  invoiceDate: Date;
  dueDate: Date;
  lines: Array<{ orderLineId: string; qty: number }>;
};

export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryErrorCode,
    readonly shortLines: Array<{ orderLineId: string; requested: number; onHand: number }> = [],
    readonly replay?: DeliveryReplayDetail,
  ) {
    super(`Delivery rejected: ${code}`);
    this.name = "DeliveryError";
  }
}

/**
 * issueKonsiTransfer's partial-consume guard: a delivered-quantity draw against the
 * StockReservation reserveKonsiFieldSalesOrder created must fit inside that row's remaining
 * headroom (`qty − consumedQty`) AND find it still RESERVED. The guard is one atomic
 * `UPDATE … WHERE state = 'RESERVED' AND consumedQty + n <= qty` — zero rows affected means
 * either the reservation is not RESERVED at all (already CONSUMED/RELEASED, or missing) or the
 * draw would exceed what is left, and this throws BEFORE any balance move for the line runs.
 * Also thrown, ahead of that statement, for a draw that is not a positive integer, which the
 * guard would otherwise pass (zero) or turn into a stock increase (negative).
 */
export class KonsiTransferReservationMismatchError extends Error {
  constructor(
    public fieldSalesLineId: string,
    public matchedCount: number,
  ) {
    super(`No RESERVED StockReservation with enough headroom for fieldSalesLineId=${fieldSalesLineId} (matched ${matchedCount})`);
    this.name = "KonsiTransferReservationMismatchError";
  }
}

export class CreditLimitExceededError extends Error {
  constructor(
    public exposure: { receivableOutstanding: number; undeliveredOrderResidual: number; total: number },
    public creditLimit: number,
    public orderTotal: number,
  ) {
    super("CREDIT_LIMIT_EXCEEDED");
    this.name = "CreditLimitExceededError";
  }
}

export type KonsiPushErrorCode =
  | "NOT_FOUND"
  | "NOT_KONSI"
  | "STORE_INACTIVE"
  | "SALESMAN_INVALID"
  | "NO_LINES"
  | "BAD_QTY"
  | "DUPLICATE"
  | "UNKNOWN_ITEM"
  | "NO_INVENTORY"
  | "KEY_CONFLICT";

export class KonsiPushError extends Error {
  constructor(
    readonly code: KonsiPushErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "KonsiPushError";
  }
}
