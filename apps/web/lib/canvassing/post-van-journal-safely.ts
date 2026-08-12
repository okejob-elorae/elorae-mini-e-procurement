import { prisma } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

/**
 * Where a `journals:manage` operator retries each van document kind once the
 * missing posting role is mapped in Account Mapping.
 */
const RETRY_HINT: Record<"load" | "sale" | "reconcile", string> = {
  load: "retry from the canvasser's van detail page (Load History)",
  sale: "retry from the van sale's detail page",
  reconcile: "retry from the van reconcile's detail page",
};

/**
 * Posts a van journal without ever failing the caller. A canvassing sale is a
 * terminal point-of-sale transaction: a finance misconfiguration must not fail
 * it in front of a customer, so a problem becomes a JOURNAL_PENDING notification
 * instead of an error.
 */
export async function postVanJournalSafely(
  kind: "load" | "sale" | "reconcile",
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
 * Skips the write when an unread `JOURNAL_PENDING` already exists for the same
 * document and kind. Mirrors `lib/finance/sales/sweep.ts`'s dedup: this MariaDB
 * adapter's JSON-path filtering is unreliable, so recent unread rows are
 * fetched and deduped in JS rather than filtered in the query.
 */
async function alreadyFlagged(kind: string, docId: string): Promise<boolean> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  return recent.some((n) => {
    const m = n.metadata as { docId?: string; kind?: string } | null;
    return m?.docId === docId && m?.kind === `van_${kind}`;
  });
}

async function notify(
  kind: "load" | "sale" | "reconcile",
  docId: string,
  reason: string,
  role: string | null,
  detail?: string,
): Promise<void> {
  try {
    if (await alreadyFlagged(kind, docId)) return;
    const vanJournalNotification = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Van ${kind} journal not posted`,
        message: `Van ${kind} journal could not be posted (${reason}${role ? `: ${role}` : ""}${detail ? `: ${detail}` : ""}). Map the account, then ${RETRY_HINT[kind]}.`,
        metadata: { docId, kind: `van_${kind}`, reason, role },
      },
    });
    await fanOutAdminNotification(vanJournalNotification);
  } catch (e) {
    /*
     * Best-effort: a notification failure must never fail the source
     * operation (load/sale/reconcile already committed). But swallowing it
     * silently is worse than it looks here: `hasPostableJournal` gates the
     * retry button on a matching JOURNAL_PENDING notification existing, so
     * if THIS write also fails, the document ends up with no journal, no
     * notification, and no retry button — permanently unpostable except by
     * hand. Log loudly so it is at least discoverable.
     */
    console.error(
      `[postVanJournalSafely] FAILED TO NOTIFY for van ${kind} ${docId} — this document has no journal and will show ` +
        "no retry button (JOURNAL_PENDING notification write also failed). It needs a manual journal entry.",
      e,
    );
  }
}
