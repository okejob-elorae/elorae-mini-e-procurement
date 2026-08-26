import { prisma } from "@elorae/db";
import type { ArJournalKind } from "./post-ar-journal-safely";

/**
 * Returns the subset of `docIds` carrying a JOURNAL_PENDING notification for this kind.
 *
 * Absence of a Journal row is NOT sufficient evidence that a retry is safe. The AR backfill gives
 * every pre-existing delivery a Receivable and none of them a journal, because auto-posting did not
 * exist when they were recorded. Offering a retry there would post DR AR / CR Revenue for goods that
 * may since have been returned, or COGS against inventory already relieved elsewhere, with nothing
 * to balance it. The notification is the only signal that a post was actually attempted AND failed
 * for THIS document, so only those may be retried.
 *
 * Matching ignores `readAt` on purpose: marking a notification read is not evidence the underlying
 * post ever succeeded.
 *
 * JSON-path filtering on this adapter is unreliable, so rows are fetched by the indexed `category`
 * column and matched in JS.
 */
export async function findPostableArJournalDocIds(
  kind: ArJournalKind,
  docIds: string[],
): Promise<Set<string>> {
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
 * Server-side enforcement of the same invariant the read path uses to decide whether to render a
 * retry control. It exists because every exported function in a `"use server"` module is an
 * independently callable endpoint, reachable by anyone holding the permission regardless of what a
 * hidden button implies.
 */
export async function isArJournalRetryable(kind: ArJournalKind, docId: string): Promise<boolean> {
  const postable = await findPostableArJournalDocIds(kind, [docId]);
  return postable.has(docId);
}
