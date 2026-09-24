export type StoreStocktakeErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "ALREADY_OPEN"
  | "VARIANCE_NEEDS_REASON"
  | "SHORTFALL_NEEDS_CAUSE"
  | "ITEM_NOT_FOUND"
  | "INVALID_REQUEST"
  | "DUPLICATE_LINE"
  | "TRANSFER_PENDING";

export class StoreStocktakeError extends Error {
  constructor(
    public code: StoreStocktakeErrorCode,
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "StoreStocktakeError";
  }
}
