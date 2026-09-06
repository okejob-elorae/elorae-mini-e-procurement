export type SettlementErrorCode =
  | "NO_INVOICES"
  | "INVALID_AMOUNT"
  | "INVALID_PERCENT"
  | "DUPLICATE_ADMIN_FEE"
  | "MISSING_EVIDENCE"
  | "RECEIVABLE_NOT_FOUND"
  | "WRONG_STORE"
  | "NOT_OUTSTANDING"
  | "FIELD_RETURN_NOT_FOUND"
  | "RETURN_NOT_APPROVED"
  | "NOT_VALUED"
  | "RETUR_OVERCLAIMED"
  | "DEDUCTIONS_EXCEED_INVOICES";

export class SettlementError extends Error {
  code: SettlementErrorCode;

  constructor(code: SettlementErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SettlementError";
    this.code = code;
  }
}
