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
  | "INVALID_DATES";

export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryErrorCode,
    readonly shortLines: Array<{ orderLineId: string; requested: number; onHand: number }> = [],
  ) {
    super(`Delivery rejected: ${code}`);
    this.name = "DeliveryError";
  }
}

/**
 * issueKonsiTransfer's defence-in-depth check: the StockReservation created by
 * reserveKonsiFieldSalesOrder earlier in the same transaction must resolve to exactly one row
 * flipped to CONSUMED. This catches a reservation that is NOT sitting RESERVED on this
 * fieldSalesLineId (already CONSUMED/RELEASED, or missing) — 0 rows matched would leave
 * reservedQty decremented with no reservation ever released against it, the exact invariant this
 * module exists to protect. It does NOT catch reserveKonsiFieldSalesOrder's own silent-skip
 * branch (an existing RESERVED row on the same fieldSalesLineId short-circuits without
 * incrementing reservedQty): that row is still RESERVED, so this still matches exactly 1 and
 * passes, even though reservedQty was never incremented for it. Not known to be reachable
 * through the current approve() guards; kept as a hard failure rather than a silent no-op
 * regardless.
 */
export class KonsiTransferReservationMismatchError extends Error {
  constructor(
    public fieldSalesLineId: string,
    public matchedCount: number,
  ) {
    super(`Expected exactly one RESERVED StockReservation for fieldSalesLineId=${fieldSalesLineId}, matched ${matchedCount}`);
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
