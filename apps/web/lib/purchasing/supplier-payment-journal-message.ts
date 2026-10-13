/**
 * Which half of the paid toggle a journal failure came from. Declared here, in
 * the module both client pages already import, rather than in the server-only
 * safe-post helper — that one pulls in Prisma, so a client component cannot
 * import a type from it without dragging the driver into the browser bundle.
 * `post-supplier-payment-journal-safely.ts` re-exports this one so there is
 * still a single definition.
 */
export type SupplierPaymentDirection = "payment" | "reversal";

/**
 * The payment-writer codes on which `setPOPaidAt` ABORTS a mark instead of
 * committing it: the compare-and-swap on `paidAt` rolls back, nothing is flagged,
 * and the action returns the code as its `refusal`. Each one says a receipt of
 * the PO is not settled yet, so the PO is not payable yet, and committing
 * `paidAt` would manufacture exactly the paid-without-a-journal state the payment
 * journal exists to prevent. The infrastructure codes (`UNMAPPED_ROLE`,
 * `UNBALANCED`, the synthetic `ERROR`, any other) are deliberately absent: a
 * misconfiguration on the PAYMENT post itself still commits the mark and raises
 * `JOURNAL_PENDING`, so it does not block ops. A receipt left un-journaled —
 * by misconfiguration (an unmapped role at receive time) or otherwise — is a
 * receipt-state verdict and aborts the mark.
 *
 * The writer answers these three BEFORE it resolves the AP role
 * (`poBookedPayable`), and that order is load-bearing: an unmapped AP role
 * reported first would commit the mark straight past an unsettled receipt.
 *
 * Declared here, in the client-safe module, so the action's guard, its result
 * type and the `markRefused.<code>` locale keys all read one list.
 */
export const RECEIPT_BLOCKED_MARK_CODES = [
  "GRN_APPROVAL_PENDING",
  "GRN_JOURNALS_INCOMPLETE",
  "GRN_REVERSAL_MISSING",
] as const;

export type ReceiptBlockedMarkCode = (typeof RECEIPT_BLOCKED_MARK_CODES)[number];

export function isReceiptBlockedMarkCode(code: string): code is ReceiptBlockedMarkCode {
  return (RECEIPT_BLOCKED_MARK_CODES as readonly string[]).includes(code);
}

/**
 * Maps a failure code `setPOPaidAt` hands back to the `supplierPayments`
 * namespace key that tells the operator what happened and what to do next.
 *
 * The three `RECEIPT_BLOCKED_MARK_CODES` no longer come back from the toggle as
 * a journal failure — it refuses them instead — but they stay listed here: the
 * banner and its retry still render them for a PO that already reads paid,
 * either one marked before the toggle aborted on them, or one whose receipts
 * changed after the mark (a later over-receive still awaiting the owner, say)
 * so that its retry meets one of them.
 *
 * The UI reaches it only through `useSupplierPaymentJournalFailureMessage`,
 * which every surface of a failed post goes through: both toggle call sites (the
 * PO detail page and the supplier-payments register), the PO page's "payment
 * journal not posted" banner and its retry. They surface the SAME server outcome
 * and must not drift into describing it differently.
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
  "PAYMENT_SUPERSEDED",
  "UNMAPPED_ROLE",
  "NOTHING_TO_POST",
  "UNBALANCED",
] as const;

/**
 * The codes whose message CANNOT be written once for both directions, so their
 * key carries the direction as a final segment (`journal.err.UNBALANCED.payment`).
 * Every other code is raised while reading the payable for a PAYMENT and is
 * unreachable on a reversal — the reversal writer mirrors the standing payment
 * journal's lines instead of resolving roles or re-reading the payable — so a
 * single sentence describing a PO left marked paid is correct for those.
 *
 * These two are not. Both are reachable in either direction (`UNBALANCED` from
 * `postJournal`'s balance check, `GENERIC` as the catch-all for a thrown post and
 * for any unrecognised code), and the two directions need to say opposite things:
 *
 * - the remedy differs. A failed payment leaves the PO marked paid with the
 *   "payment journal not posted" banner, so the fix is that banner's "Post
 *   payment journal". A failed reversal leaves it unpaid, where "Mark paid" is
 *   the only toggle on offer and cannot post the missing reversal — that
 *   direction has to point at the standing-payment warning's own control.
 * - the ledger claim differs. A failed payment wrote nothing. A failed reversal
 *   leaves the earlier payment journal standing — payables cleared, bank credited
 *   — for a PO that now reads unpaid, so telling the operator payables and bank
 *   are "untouched" would deny the exact gap the message exists to report.
 */
const DIRECTION_SPECIFIC_CODES: readonly string[] = ["UNBALANCED", "GENERIC"];

export function supplierPaymentJournalErrorKey(
  code: string,
  direction: SupplierPaymentDirection,
): string {
  const resolved = (SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES as readonly string[]).includes(code)
    ? code
    : "GENERIC";
  return DIRECTION_SPECIFIC_CODES.includes(resolved)
    ? `journal.err.${resolved}.${direction}`
    : `journal.err.${resolved}`;
}
