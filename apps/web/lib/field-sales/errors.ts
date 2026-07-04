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
