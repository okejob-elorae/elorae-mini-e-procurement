export type CollectionErrorCode =
  | "NOT_ELIGIBLE"
  | "ALREADY_SETTLED"
  | "EMPTY_TARGETS"
  | "DUPLICATE_TARGETS"
  | "NOT_ASSIGNED_COLLECTOR"
  | "INVALID_AMOUNT"
  | "OVER_COLLECTED"
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "MISSING_REASON"
  | "INVALID_METHOD";

export class CollectionError extends Error {
  code: CollectionErrorCode;

  constructor(code: CollectionErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CollectionError";
    this.code = code;
  }
}
