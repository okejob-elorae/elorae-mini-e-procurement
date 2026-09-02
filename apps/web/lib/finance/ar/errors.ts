export type PaymentErrorCode =
  | "INVALID_AMOUNT"
  | "NO_ALLOCATIONS"
  | "ALLOCATION_MISMATCH"
  | "OVER_ALLOCATED"
  | "WRONG_STORE"
  | "NOT_FOUND"
  | "ALREADY_SETTLED"
  | "DUPLICATE_ALLOCATION"
  | "MISSING_REASON"
  | "RETURN_NOT_APPROVED"
  | "NOT_VALUED"
  | "ALREADY_APPLIED"
  | "INSUFFICIENT_OUTSTANDING"
  | "PAYMENT_VOIDED";

export class PaymentError extends Error {
  code: PaymentErrorCode;

  constructor(code: PaymentErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PaymentError";
    this.code = code;
  }
}
