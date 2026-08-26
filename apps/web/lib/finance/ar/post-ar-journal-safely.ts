import { prisma, type AdminNotification } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

export type ArJournalKind =
  | "field_delivery_revenue"
  | "field_delivery_cogs"
  | "ar_payment"
  | "ar_payment_void";

const TITLE: Record<ArJournalKind, string> = {
  field_delivery_revenue: "Nota tagihan revenue journal not posted",
  field_delivery_cogs: "Nota tagihan COGS journal not posted",
  ar_payment: "Payment receipt journal not posted",
  ar_payment_void: "Payment void reversal journal not posted",
};

/**
 * Where a `journals:manage` operator retries each kind once the missing posting role is mapped.
 *
 * The void reversal needs its own control rather than a re-run of the void: a failed reversal
 * leaves the payment VOIDED with its receipt journal still standing, so the GL overstates cash and
 * understates AR, and from VOIDED no other action would post the missing entry.
 */
const RETRY_HINT: Record<ArJournalKind, string> = {
  field_delivery_revenue: "retry from the receivable's detail page",
  field_delivery_cogs: "retry from the receivable's detail page",
  ar_payment: "retry from the payment's detail page",
  ar_payment_void: 'open the payment and use the standing-payment warning\'s "Post reversal journal" action',
};

/**
 * Posts an AR journal without ever failing the caller. Recording a delivery or collecting a payment
 * must not fail because a finance account is unmapped, so a problem becomes a JOURNAL_PENDING
 * notification instead of an error the operator cannot act on.
 */
export async function postArJournalSafely(
  kind: ArJournalKind,
  docId: string,
  post: () => Promise<GenerateAutoJournalResult>,
): Promise<void> {
  try {
    const res = await post();
    if (res.ok || res.code === "NOTHING_TO_POST") return;
    await notify(kind, docId, res.code, "role" in res ? (res.role ?? null) : null);
  } catch (e) {
    await notify(kind, docId, "ERROR", null, e instanceof Error ? e.message : "unknown");
  }
}

/**
 * Dedup is on the (docId, kind, REASON) triple, never on the pair alone.
 *
 * With the pair only, a CHANGED failure is silently swallowed: the first post fails UNMAPPED_ROLE,
 * the operator maps the account and retries, the retry fails for a different reason, and the only
 * surviving signal is the unread UNMAPPED_ROLE row telling them to do exactly what they just did.
 * That is worse than no dedup, because it actively misdirects. Matching on reason keeps both
 * properties — a repeat writes nothing, a new failure always writes — and accumulation stays
 * bounded at one unread row per distinct reason per document and kind.
 *
 * This MariaDB adapter's JSON-path filtering is unreliable, so recent unread rows are fetched by
 * the indexed `category` column and matched in JS rather than filtered in the query.
 */
async function alreadyFlagged(kind: ArJournalKind, docId: string, reason: string): Promise<boolean> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  return recent.some((n) => {
    const m = n.metadata as { docId?: string; kind?: string; reason?: string } | null;
    return m?.docId === docId && m?.kind === kind && m?.reason === reason;
  });
}

async function notify(
  kind: ArJournalKind,
  docId: string,
  reason: string,
  role: string | null,
  detail?: string,
): Promise<void> {
  let arJournalNotification: AdminNotification | null = null;
  try {
    if (await alreadyFlagged(kind, docId, reason)) return;
    arJournalNotification = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: TITLE[kind],
        message:
          `${TITLE[kind]} (${reason}${role ? `: ${role}` : ""}${detail ? `: ${detail}` : ""}). ` +
          `Map the account, then ${RETRY_HINT[kind]}.`,
        metadata: { docId, kind, reason, role },
      },
    });
  } catch (e) {
    /*
     * Best-effort: a notification failure must never fail the source operation, which has already
     * committed. But swallowing it silently is total invisibility — the retry control is gated on a
     * matching JOURNAL_PENDING row existing, so if THIS write also fails the document ends up with
     * no journal, no notification and no retry button, permanently unpostable except by hand.
     */
    console.error(
      `[postArJournalSafely] FAILED TO NOTIFY for ${kind} ${docId} — the journal did not post and the ` +
        `JOURNAL_PENDING notification write also failed (${reason}). It needs a manual journal entry.`,
      e,
    );
  }

  /**
   * Below the try/catch, not inside it: reaching here means the row is committed, so the retry
   * control WILL render — the catch above says the opposite, and a delivery failure must never be
   * able to reach it. Not awaited either: fan-out walks recipients with an FCM call each, which
   * firebase-admin retries for roughly a minute per recipient when the network is unreachable.
   */
  if (arJournalNotification) void fanOutAdminNotification(arJournalNotification);
}
