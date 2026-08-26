export type PaymentErrorCode =
  | "INVALID_AMOUNT"
  | "NO_ALLOCATIONS"
  | "ALLOCATION_MISMATCH"
  | "OVER_ALLOCATED"
  | "WRONG_STORE"
  | "NOT_FOUND"
  | "ALREADY_SETTLED"
  | "MISSING_REASON";

export class PaymentError extends Error {
  code: PaymentErrorCode;

  constructor(code: PaymentErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PaymentError";
    this.code = code;
  }
}
