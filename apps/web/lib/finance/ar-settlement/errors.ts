export type SettlementErrorCode =
  | "INVALID_DRAFT_ID"
  | "NO_INVOICES"
  | "INVALID_AMOUNT"
  | "INVALID_PERCENT"
  | "INVALID_DEDUCTIONS"
  | "DUPLICATE_INVOICE"
  | "DUPLICATE_ADMIN_FEE"
  | "MISSING_EVIDENCE"
  | "INVALID_PROOF_KEY"
  | "DUPLICATE_PROOF_KEY"
  | "SALESMAN_NOT_FOUND"
  | "RECEIVABLE_NOT_FOUND"
  | "WRONG_STORE"
  | "RETUR_WRONG_STORE"
  | "NOT_OUTSTANDING"
  | "INVOICE_OVERCLAIMED"
  | "FIELD_RETURN_NOT_FOUND"
  | "MISSING_FIELD_RETURN_ID"
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
