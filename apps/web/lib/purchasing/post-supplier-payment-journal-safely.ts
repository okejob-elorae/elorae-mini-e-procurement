import { prisma } from "@elorae/db";
import { isRetryableTxError } from "@/lib/db/tx-retry";
import type { PostSupplierPaymentResult, PostSupplierPaymentReversalResult } from "./supplier-payment-journal";
import type { SupplierPaymentDirection } from "./supplier-payment-journal-message";

/* Re-exported, not redeclared: the canonical definition lives in the client-safe
   message module so the toast mapper can take it without importing Prisma. */
export type { SupplierPaymentDirection };

/** A post that did not produce a journal, in the shape `notify` needs. */
export type SupplierPaymentPostFailure = { reason: string; role: string | null; detail?: string };

const NOTIFICATION_KIND: Record<SupplierPaymentDirection, string> = {
  payment: "supplier_payment",
  reversal: "supplier_payment_reversal",
};

/**
 * How an operator re-runs a failed post, which differs by direction.
 *
 * A failed PAYMENT needs no retry button: it left the PO marked paid, so the
 * paid toggle IS the retry — unmark, then mark paid again, and the same post is
 * attempted afresh.
 *
 * A failed REVERSAL cannot be retried that way, which is why it points at a
 * dedicated control instead. It left the PO unpaid with its payment journal
 * still standing, and from unpaid the UI only offers "Mark paid" — which either
 * refuses with `PAYMENT_SUPERSEDED` (once the payable has moved) or hits the
 * standing journal idempotently. Neither posts the reversal that is missing, so
 * the mark/unmark dance this hint used to recommend was awkward at best and
 * blocked at worst. `postSupplierPaymentReversalJournalAction`, surfaced by the
 * standing-payment warning on the PO detail page, posts it directly.
 */
const RETRY_HINT: Record<SupplierPaymentDirection, string> = {
  payment: "unmark payment on the PO and mark it paid again",
  reversal: 'open the PO and use the standing-payment warning\'s "Post reversal journal" action',
};

/**
 * Runs the journal post and classifies the outcome, returning `null` when there
 * is nothing to tell the operator. Deliberately split from the notification
 * write: the caller runs this INSIDE the same serializable transaction as the
 * paid toggle (so a concurrent toggle cannot interleave between the two), then
 * writes the notification after that transaction has committed. A notification
 * must never be rolled back by transaction contention, nor add its own write to
 * it.
 *
 * Never throws for a journal problem, so a finance misconfiguration cannot fail
 * the toggle — it becomes a `JOURNAL_PENDING` notification instead of an error
 * the operator cannot act on. A RETRYABLE transaction error is the one thing it
 * does rethrow: MariaDB has already rolled the whole transaction back by then,
 * so swallowing it would commit nothing while reporting a toggle that happened.
 * Letting it out lets `runSerializable` retry the toggle and the post together.
 *
 * An `ok` result is silent even when nothing was created, because the writer only
 * reports an idempotent hit as `ok` once it has confirmed the journal already
 * standing posted the same payable this attempt computed — a stale one comes back
 * as `PAYMENT_SUPERSEDED` instead. So `ok` here genuinely means the ledger
 * reflects this payment, whether this attempt posted it or an earlier one did.
 *
 * `NOTHING_TO_POST` is silent for a reversal and loud for a payment. Nothing to
 * reverse is a genuine no-op — the payment never posted, so there is no journal
 * to undo. Nothing to PAY is not: the PO is now flagged paid while no payable
 * was ever booked for it, which means either the payment does not correspond to
 * anything received (an advance) or receipts exist that could never book a
 * payable at all — each one sub-cent or owner-declined. A receipt whose booked
 * payable is wrong or not final yet is NOT one of these cases: one still owed
 * with no journal returns `GRN_JOURNALS_INCOMPLETE`, a declined one left
 * un-reversed returns `GRN_REVERSAL_MISSING`, and one still awaiting the owner's
 * approve-or-decline returns `GRN_APPROVAL_PENDING`, each carrying its own
 * remedy.
 *
 * Takes either writer's result because the toggle runs one of the two by
 * direction. `PO_IS_PAID` is in the reversal writer's union but unreachable from
 * here: the unmark branch clears `paidAt` in the same transaction before posting,
 * so the guard that raises it always sees null. It stays in the accepted type
 * rather than being cast away, so a future caller that DOES hit it gets a
 * classified failure instead of a type error.
 */
export async function attemptSupplierPaymentJournal(
  direction: SupplierPaymentDirection,
  post: () => Promise<PostSupplierPaymentResult | PostSupplierPaymentReversalResult>,
): Promise<SupplierPaymentPostFailure | null> {
  try {
    const res = await post();
    if (res.ok) return null;
    if (res.code === "NOTHING_TO_POST" && direction === "reversal") return null;
    return { reason: res.code, role: "role" in res ? (res.role ?? null) : null };
  } catch (e) {
    if (isRetryableTxError(e)) throw e;
    return { reason: "ERROR", role: null, detail: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Writes the `JOURNAL_PENDING` row for a failure `attemptSupplierPaymentJournal`
 * reported. Must run AFTER the toggle's transaction has committed — see that
 * function's note.
 */
export async function notifySupplierPaymentJournalFailure(
  direction: SupplierPaymentDirection,
  poId: string,
  failure: SupplierPaymentPostFailure,
): Promise<void> {
  await notify(direction, poId, failure.reason, failure.role, failure.detail);
}

function titleFor(direction: SupplierPaymentDirection, reason: string): string {
  /*
   * Checked before every reason below because none of them can describe a
   * reversal: the codes that follow are all raised while READING the payable for
   * a payment, and the reversal writer never reaches that read. What a failed
   * reversal leaves behind is one state regardless of reason — the PO unpaid with
   * its payment journal still standing — and that is what the title has to say.
   */
  if (direction === "reversal") {
    return "PO unmarked as paid but its payment journal is still standing";
  }
  if (direction === "payment" && reason === "NOTHING_TO_POST") {
    return "PO marked paid but no payable was booked for it";
  }
  if (reason === "GRN_APPROVAL_PENDING") {
    return "PO marked paid but one of its receipts is still awaiting the owner's decision";
  }
  if (reason === "GRN_JOURNALS_INCOMPLETE") {
    return "PO marked paid but one of its receipts has no GRN journal";
  }
  if (reason === "GRN_REVERSAL_MISSING") {
    return "PO marked paid but a declined receipt has no GRN reversal journal";
  }
  if (reason === "PAYMENT_SUPERSEDED") {
    return "PO marked paid but an earlier payment journal still stands for a different amount";
  }
  return "Supplier payment journal not posted";
}

function messageFor(
  direction: SupplierPaymentDirection,
  reason: string,
  role: string | null,
  detail?: string,
): string {
  const retry = RETRY_HINT[direction];

  /*
   * Reversal-direction messages are their own sentences rather than the payment
   * ones with a different retry hint. Two reasons why: a failed reversal did not
   * leave the PO "marked paid" as every payment message below states, and it is
   * the one direction where the ledger is definitely OUT OF STEP rather than
   * untouched — the payment journal it failed to undo is still standing, with
   * payables cleared and bank credited for a PO that now reads unpaid.
   *
   * Only two reasons reach here: `UNBALANCED` from `postJournal`'s balance check
   * and the synthetic `ERROR` for a thrown post. `NOTHING_TO_POST` never does —
   * `attemptSupplierPaymentJournal` treats nothing-to-reverse as a genuine no-op
   * and stays silent. The payable-read codes (`GRN_*`, `AP_ACCOUNT_MISMATCH`,
   * `UNMAPPED_ROLE`, `PAYMENT_SUPERSEDED`) are unreachable because the reversal
   * writer mirrors the standing payment journal's own lines instead of resolving
   * roles or reading the payable, so the trailing branch is a guard against a
   * future code, not a live case.
   */
  if (direction === "reversal") {
    const standing =
      "The PO's paid mark was removed, but its reversal journal did not post, so the payment journal it should have " +
      "undone is still standing on the ledger: payables are cleared and bank is credited for a PO that now reads " +
      "unpaid. ";
    if (reason === "UNBALANCED") {
      return (
        standing +
        `The reversal was rejected as unbalanced (debit ≠ credit) before anything was written for it. To fix, ${retry}.`
      );
    }
    if (reason === "ERROR") {
      return standing + `The reversal errored (${detail ?? "unknown"}). To fix, ${retry}.`;
    }
    return standing + `The reversal reported ${reason}${role ? `: ${role}` : ""}. To fix, ${retry}.`;
  }

  if (reason === "NOTHING_TO_POST") {
    /*
     * A receipt still owed with no journal, a declined-but-un-reversed one and
     * one still awaiting the owner's decision all fail earlier with their own
     * codes — `GRN_JOURNALS_INCOMPLETE`, `GRN_REVERSAL_MISSING` and
     * `GRN_APPROVAL_PENDING` — so the remaining causes are all "there is
     * genuinely nothing bookable", and the remedy is to question the payment
     * itself rather than to go post a journal.
     */
    return (
      "The PO was marked paid, but no payable was found booked to the GL for it, so no journal was posted — " +
      "payables and bank are both untouched. Either the PO has no receipts and this is an advance payment " +
      "(which the GL cannot represent yet), none of its receipts could ever book a payable (each one worth under " +
      "a cent or declined by the owner), or its payable was already cleared by reversals. Confirm the PO should be " +
      `marked paid at all; if a receipt is missing, receive it, then ${retry}.`
    );
  }
  if (reason === "GRN_APPROVAL_PENDING") {
    return (
      "The PO was marked paid, but one of its receipts is an over-receive still waiting for the owner to approve or " +
      "decline it, so no payment journal was posted — payables and bank are both untouched. That receipt already " +
      "credited payables in full when it was received, and declining it reverses that against inventory without ever " +
      "touching the bank: paying now would leave the cash-out standing while the decline debits payables a second " +
      "time, driving payables negative and overpaying the supplier on the books. Have the owner approve or decline " +
      `the pending receipt first, then ${retry}.`
    );
  }
  if (reason === "GRN_JOURNALS_INCOMPLETE") {
    return (
      "The PO was marked paid, but at least one of its receipts has no GRN journal, so no payment journal was posted — " +
      "payables and bank are both untouched. Paying only the journaled receipts would have under-paid, and the rest " +
      "would have reappeared in payables as soon as the missing GRN journal was retried. Post the missing GRN journal " +
      `from its GRN row, then ${retry}.`
    );
  }
  if (reason === "GRN_REVERSAL_MISSING") {
    return (
      "The PO was marked paid, but one of its receipts was declined by the owner and its GRN journal was never " +
      "reversed, so no payment journal was posted — payables and bank are both untouched. The declined receipt's " +
      "payable is still booked, so paying now would have over-paid by that amount. Post the reversal journal from " +
      `the declined GRN's row, then ${retry}.`
    );
  }
  if (reason === "PAYMENT_SUPERSEDED") {
    /*
     * The one failure where payables and bank are NOT untouched, so this message
     * deliberately says the opposite of every other one here: an earlier payment
     * journal is still standing, for an amount that no longer clears the PO.
     * Saying "untouched" would send the operator looking for a missing journal
     * instead of the stale one they have to reverse.
     */
    return (
      "The PO was marked paid, but a payment journal from an earlier mark is still standing on the ledger for a " +
      "different amount than this PO now owes, so no new journal was posted. Payables and bank are NOT untouched " +
      "here — they still hold that earlier payment, which no longer clears this PO's payable. This happens when an " +
      "unmark's reversal journal failed to post and the payable changed afterwards (another receipt was journaled, " +
      `for instance). To fix, ${retry} — and confirm the reversal journal actually posted this time before treating ` +
      "the PO as paid. If that unmark's reversal fails too, the PO detail page raises a standing-payment warning with " +
      "a control that posts the reversal directly."
    );
  }
  if (reason === "AP_ACCOUNT_MISMATCH") {
    return (
      "Supplier payment journal could not be posted (AP_ACCOUNT_MISMATCH). The receipts booked their payable to a " +
      "different account than the AP posting role now resolves to. Check the AP account mapping against the account " +
      `the receipts actually credited, then ${retry}.`
    );
  }
  if (reason === "ERROR") {
    return `Supplier payment journal errored (${detail ?? "unknown"}). Verify the account mapping, then ${retry}.`;
  }
  return `Supplier payment journal could not be posted (${reason}${role ? `: ${role}` : ""}). Map the account, then ${retry}.`;
}

/**
 * Skips the write when an unread `JOURNAL_PENDING` already exists for the same
 * PO, direction AND failure reason, so a toggle that keeps failing the same way
 * does not pile up duplicate rows.
 *
 * The reason is part of the match, unlike the van sibling's `(docId, kind)`,
 * because this flow has several codes with several different remedies. Dedup on
 * the pair alone silently swallows a CHANGED failure: the first mark fails
 * `UNMAPPED_ROLE`, the operator maps the account and re-marks, the post now
 * fails `GRN_JOURNALS_INCOMPLETE`, and the only surviving signal is the unread
 * `UNMAPPED_ROLE` row telling them to do what they just did. That is worse than
 * no dedup, because it actively misdirects. Matching on the reason keeps both
 * properties: the same failure repeated writes nothing, a different one always
 * writes. Accumulation stays bounded at one unread row per distinct reason per
 * PO and direction.
 *
 * Chosen over updating the existing row in place because `AdminNotification` has
 * no `updatedAt` and a refreshed row would keep its original `createdAt` — it
 * would rank by the stale first-failure time in any feed reading these (the bell
 * is still an open follow-up), and it would age out of the recency window this
 * very dedup scans, at which point the dedup breaks anyway AND leaves the stale
 * row behind. A new row is honest about when the new failure happened.
 *
 * Mirrors `lib/canvassing/post-van-journal-safely.ts` on the read shape: this
 * MariaDB adapter's JSON-path filtering is unreliable, so recent unread rows are
 * fetched and matched in JS rather than filtered in the query.
 */
async function alreadyFlagged(
  direction: SupplierPaymentDirection,
  poId: string,
  reason: string,
): Promise<boolean> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  return recent.some((n) => {
    const m = n.metadata as { docId?: string; kind?: string; reason?: string } | null;
    return m?.docId === poId && m?.kind === NOTIFICATION_KIND[direction] && m?.reason === reason;
  });
}

async function notify(
  direction: SupplierPaymentDirection,
  poId: string,
  reason: string,
  role: string | null,
  detail?: string,
): Promise<void> {
  try {
    if (await alreadyFlagged(direction, poId, reason)) return;
    await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: titleFor(direction, reason),
        message: messageFor(direction, reason, role, detail),
        metadata: { docId: poId, kind: NOTIFICATION_KIND[direction], reason, role },
      },
    });
  } catch (e) {
    /*
     * Best-effort: a notification failure must never fail the paid toggle,
     * which has already committed. But swallowing it silently is total
     * invisibility — nothing in the UI renders `AdminNotification`, and this
     * row is the only trace that a post was attempted and failed, so log
     * loudly to keep it discoverable in the server log at least.
     */
    console.error(
      `[notifySupplierPaymentJournalFailure] FAILED TO NOTIFY for supplier ${direction} on PO ${poId} — the journal did ` +
        `not post and the JOURNAL_PENDING notification write also failed (${reason}). To recover: ${RETRY_HINT[direction]}.`,
      e,
    );
  }
}
