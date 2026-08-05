import { prisma } from "@elorae/db";
import type { PostSupplierPaymentResult } from "./supplier-payment-journal";

export type SupplierPaymentDirection = "payment" | "reversal";

const NOTIFICATION_KIND: Record<SupplierPaymentDirection, string> = {
  payment: "supplier_payment",
  reversal: "supplier_payment_reversal",
};

/**
 * How an operator re-runs a failed post. There is no retry button because the
 * paid toggle IS the retry, but the order depends on where the PO now sits: a
 * failed payment left it marked paid, so the operator unmarks and re-marks,
 * while a failed reversal left it unpaid, where the UI only offers "Mark paid"
 * — so that direction has to mark first and unmark second.
 */
const RETRY_HINT: Record<SupplierPaymentDirection, string> = {
  payment: "unmark payment on the PO and mark it paid again",
  reversal: "mark payment on the PO and unmark it again",
};

/**
 * Posts a supplier payment journal without ever failing the caller. The paid
 * toggle and its status history have already committed, so a finance
 * misconfiguration becomes a `JOURNAL_PENDING` notification instead of an
 * error the operator cannot act on.
 *
 * `NOTHING_TO_POST` is silent for a reversal and loud for a payment. Nothing to
 * reverse is a genuine no-op — the payment never posted, so there is no journal
 * to undo. Nothing to PAY is not: the PO is now flagged paid while no payable
 * was ever booked for it, which means either the payment does not correspond to
 * anything received (an advance) or receipts exist that could never book a
 * payable at all. An un-journaled receipt is NOT one of these cases — that
 * returns `GRN_JOURNALS_INCOMPLETE`, which carries its own remedy.
 */
export async function postSupplierPaymentJournalSafely(
  direction: SupplierPaymentDirection,
  poId: string,
  post: () => Promise<PostSupplierPaymentResult>,
): Promise<void> {
  try {
    const res = await post();
    if (res.ok) return;
    if (res.code === "NOTHING_TO_POST" && direction === "reversal") return;
    await notify(direction, poId, res.code, "role" in res ? (res.role ?? null) : null);
  } catch (e) {
    await notify(direction, poId, "ERROR", null, e instanceof Error ? e.message : "unknown");
  }
}

function titleFor(direction: SupplierPaymentDirection, reason: string): string {
  if (direction === "payment" && reason === "NOTHING_TO_POST") {
    return "PO marked paid but no payable was booked for it";
  }
  if (reason === "GRN_JOURNALS_INCOMPLETE") {
    return "PO marked paid but one of its receipts has no GRN journal";
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
  if (reason === "NOTHING_TO_POST") {
    /*
     * An un-journaled receipt cannot reach here — that returns
     * `GRN_JOURNALS_INCOMPLETE` — so the remaining causes are all "there is
     * genuinely nothing bookable", and the remedy is to question the payment
     * itself rather than to go post a journal.
     */
    return (
      "The PO was marked paid, but no payable was found booked to the GL for it, so no journal was posted — " +
      "payables and bank are both untouched. Either the PO has no receipts and this is an advance payment " +
      "(which the GL cannot represent yet), its receipts are all worth under a cent, or its payable was already " +
      `cleared by reversals. Confirm the PO should be marked paid at all; if a receipt is missing, receive it, then ${retry}.`
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
 * PO and direction, so a repeated toggle does not pile up duplicate rows.
 * Mirrors `lib/canvassing/post-van-journal-safely.ts`: this MariaDB adapter's
 * JSON-path filtering is unreliable, so recent unread rows are fetched and
 * matched in JS rather than filtered in the query.
 */
async function alreadyFlagged(direction: SupplierPaymentDirection, poId: string): Promise<boolean> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  return recent.some((n) => {
    const m = n.metadata as { docId?: string; kind?: string } | null;
    return m?.docId === poId && m?.kind === NOTIFICATION_KIND[direction];
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
    if (await alreadyFlagged(direction, poId)) return;
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
      `[postSupplierPaymentJournalSafely] FAILED TO NOTIFY for supplier ${direction} on PO ${poId} — the journal did ` +
        `not post and the JOURNAL_PENDING notification write also failed (${reason}). To recover: ${RETRY_HINT[direction]}.`,
      e,
    );
  }
}
