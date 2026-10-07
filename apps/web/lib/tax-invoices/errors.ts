export type TaxInvoiceErrorCode = "NOT_FOUND" | "INVALID_STATE" | "INVALID_REQUEST" | "CONFLICT" | "REASON_TOO_LONG";

/**
 * Every transition copies its reason into `AuditLog.reason`, a bare `String?` — MySQL
 * `VARCHAR(191)` — so 191 is the real ceiling even though `TaxInvoice.reason` itself is
 * `@db.Text`. The writer refuses anything longer with `REASON_TOO_LONG` before it opens a
 * transaction; the dialog caps its field at the same figure. This module stays import-free so the
 * client component can read the constant.
 */
export const MAX_TAX_INVOICE_REASON_LENGTH = 191;

export class TaxInvoiceError extends Error {
  constructor(public code: TaxInvoiceErrorCode) {
    super(code);
    this.name = "TaxInvoiceError";
  }
}
