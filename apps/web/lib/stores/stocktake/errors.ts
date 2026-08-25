export type StoreStocktakeErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "ALREADY_OPEN"
  | "VARIANCE_NEEDS_REASON"
  | "SHORTFALL_NEEDS_CAUSE"
  | "ITEM_NOT_FOUND"
  | "INVALID_REQUEST";

export class StoreStocktakeError extends Error {
  constructor(public code: StoreStocktakeErrorCode) {
    super(code);
    this.name = "StoreStocktakeError";
  }
}
