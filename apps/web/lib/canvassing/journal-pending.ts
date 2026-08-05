import { prisma } from "@elorae/db";

export type VanJournalKind = "van_load" | "van_sale" | "van_reconcile";

/**
 * Returns the subset of `docIds` that have a `JOURNAL_PENDING` AdminNotification
 * recording a failed auto-post attempt for this van document kind.
 *
 * Absence of a Journal row is NOT sufficient evidence that a "Post journal"
 * retry button is safe to show. Every van document created before auto-posting
 * existed also has no Journal row, because auto-posting never ran for it.
 * Offering a retry there would replay a one-sided journal (e.g. DR
 * INVENTORY_VAN / CR INVENTORY for van stock that may already have been sold
 * or returned in a completed cycle) with no matching sale/reconcile journal to
 * balance it against. The notification is the only signal that a post was
 * actually attempted and failed for THIS specific document, so only that
 * document may be retried. Matching ignores `readAt` on purpose: marking the
 * notification read is not evidence the underlying post ever succeeded.
 *
 * MariaDB JSON-path filtering on this Prisma adapter is unreliable (same
 * constraint noted in `lib/finance/sales/sweep.ts` and
 * `post-van-journal-safely.ts`), so notifications are fetched by the indexed
 * `category` column and matched against `docIds`/`kind` in JS instead of a
 * JSON-path query.
 */
export async function findPostableJournalDocIds(kind: VanJournalKind, docIds: string[]): Promise<Set<string>> {
  if (docIds.length === 0) return new Set();
  const idSet = new Set(docIds);
  const notifications = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { metadata: true },
  });
  const flagged = new Set<string>();
  for (const n of notifications) {
    const m = n.metadata as { docId?: string; kind?: string } | null;
    if (m?.kind === kind && m.docId !== undefined && idSet.has(m.docId)) flagged.add(m.docId);
  }
  return flagged;
}

/**
 * Single-document convenience wrapper over `findPostableJournalDocIds`.
 *
 * This is the server-side enforcement of the same invariant the read path
 * (`hasPostableJournal` on the query layer) uses to decide whether to render
 * a "Post journal" retry button. It exists because the retry server actions
 * (`postVanLoadJournalAction`, `postVanSaleJournalAction`,
 * `postVanReconcileJournalAction`) must not rely on the UI having hidden the
 * button — every exported function in a `"use server"` module is an
 * independently callable endpoint, reachable by anyone holding
 * `journals:manage`, a backfill script, or a hand-crafted request, regardless
 * of what the button's visibility implies.
 */
export async function isJournalRetryable(kind: VanJournalKind, docId: string): Promise<boolean> {
  const postable = await findPostableJournalDocIds(kind, [docId]);
  return postable.has(docId);
}
