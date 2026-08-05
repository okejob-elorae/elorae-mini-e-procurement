/**
 * Maps a failure code `setPOPaidAt` hands back to the `supplierPayments`
 * namespace key that tells the operator what happened and what to do next.
 *
 * Shared by both toggle call sites — the PO detail page and the supplier-payments
 * register — because they surface the SAME server outcome and must not drift into
 * describing it differently.
 *
 * Every code is whitelisted rather than interpolated straight into a key: an
 * unrecognised one (a future code, or the synthetic `ERROR` the safe-post wrapper
 * produces for a thrown journal) would otherwise resolve to a missing message and
 * render as a raw key, which is worse than a generic sentence at exactly the
 * moment the operator needs to be told the ledger is out of step.
 */
export const SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES = [
  "GRN_APPROVAL_PENDING",
  "GRN_JOURNALS_INCOMPLETE",
  "GRN_REVERSAL_MISSING",
  "AP_ACCOUNT_MISMATCH",
  "UNMAPPED_ROLE",
  "NOTHING_TO_POST",
  "UNBALANCED",
] as const;

export function supplierPaymentJournalErrorKey(code: string): string {
  return (SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES as readonly string[]).includes(code)
    ? `journal.err.${code}`
    : "journal.err.GENERIC";
}
