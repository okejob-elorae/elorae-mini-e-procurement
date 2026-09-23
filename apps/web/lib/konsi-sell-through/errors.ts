export type SellThroughErrorCode =
  | "NOT_FOUND"
  | "STOCKTAKE_NOT_APPROVED"
  | "NOT_FULL_COUNT"
  | "NOT_KONSI"
  | "METHOD_NOT_SET"
  | "ALREADY_USED"
  | "DRAFT_EXISTS"
  | "OUT_OF_ORDER"
  | "UNKNOWN_REF_TYPE"
  | "HELD"
  | "STALE"
  | "INVALID_STATE"
  | "INVALID_RESOLUTION"
  | "REASON_REQUIRED";

export class SellThroughError extends Error {
  constructor(
    readonly code: SellThroughErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SellThroughError";
  }
}
