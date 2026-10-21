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
  | "EXCEEDS_REMAINING"
  | "PAYMENT_VOIDED"
  | "SETTLEMENT_COMPONENT"
  | "NOT_A_RESIDUE"
  | "PENDING_CLAIM"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_EVENT_ID";

export class PaymentError extends Error {
  code: PaymentErrorCode;

  /**
   * `detail` is data the operator needs to act on the refusal, not a message — today only
   * `SETTLEMENT_COMPONENT` sets it, to the owning store settlement's docNo.
   */
  constructor(
    code: PaymentErrorCode,
    message?: string,
    readonly detail?: string,
  ) {
    super(message ?? code);
    this.name = "PaymentError";
    this.code = code;
  }
}
