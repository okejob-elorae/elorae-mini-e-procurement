export type TaxInvoiceErrorCode = "NOT_FOUND" | "INVALID_STATE" | "INVALID_REQUEST" | "CONFLICT";

export class TaxInvoiceError extends Error {
  constructor(public code: TaxInvoiceErrorCode) {
    super(code);
    this.name = "TaxInvoiceError";
  }
}
