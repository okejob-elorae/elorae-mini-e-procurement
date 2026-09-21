export type StoreTransferErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "SAME_STORE"
  | "NO_LINES"
  | "BAD_QTY"
  | "ITEM_NOT_FOUND";

export class StoreTransferError extends Error {
  constructor(public code: StoreTransferErrorCode) {
    super(code);
    this.name = "StoreTransferError";
  }
}
