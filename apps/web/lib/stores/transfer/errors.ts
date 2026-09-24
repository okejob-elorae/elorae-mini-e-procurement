export type StoreTransferErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "SAME_STORE"
  | "NO_LINES"
  | "BAD_QTY"
  | "ITEM_NOT_FOUND"
  | "STORE_NOT_FOUND"
  | "MOVED_AT_IN_FUTURE"
  | "COUNTED_SINCE_MOVE";

export class StoreTransferError extends Error {
  constructor(
    public code: StoreTransferErrorCode,
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "StoreTransferError";
  }
}
