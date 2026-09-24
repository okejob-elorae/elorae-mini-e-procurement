export type SellThroughErrorCode =
  | "NOT_FOUND"
  | "STOCKTAKE_NOT_APPROVED"
  | "NOT_FULL_COUNT"
  | "NOT_KONSI"
  | "METHOD_NOT_SET"
  | "ALREADY_USED"
  | "DRAFT_EXISTS"
  | "OUT_OF_ORDER"
  | "BEFORE_LEDGER_CUTOVER"
  | "RETUR_IN_FLIGHT"
  | "TRANSFER_IN_FLIGHT"
  | "UNKNOWN_REF_TYPE"
  | "HELD"
  | "STALE"
  | "INVALID_STATE"
  | "INVALID_RESOLUTION"
  | "REASON_REQUIRED"
  | "UNPRICED"
  | "INVALID_INVOICE_DATE"
  | "SALESMAN_REQUIRED"
  | "SALESMAN_INVALID"
  | "BASELINE_NOT_FIRST"
  | "BASELINE_REASON_REQUIRED";

export class SellThroughError extends Error {
  constructor(
    readonly code: SellThroughErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SellThroughError";
  }
}
