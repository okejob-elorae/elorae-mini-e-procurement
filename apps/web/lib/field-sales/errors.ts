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
