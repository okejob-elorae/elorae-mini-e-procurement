import { prisma } from "@elorae/db";
import type { ArJournalKind } from "./post-ar-journal-safely";

export type ArJournalPendingFlag = { reason: string | null; role: string | null };

/**
 * The most recent JOURNAL_PENDING flag for each of `docIds` that carries one, keyed by `docId`.
 *
 * `postArJournalSafely` dedups on the (docId, kind, reason) triple rather than the pair, so one
 * document can hold several rows once a retry fails differently from the first attempt. The newest
 * row is the one describing the CURRENT obstacle — an older one tells the operator to do something
 * they have already done — so rows are read newest-first and the first seen per document wins.
 *
 * Matching ignores `readAt` on purpose: marking a notification read is not evidence the underlying
 * post ever succeeded.
 *
 * JSON-path filtering on this adapter is unreliable, so rows are fetched by the indexed `category`
 * column and matched in JS.
 */
export async function findArJournalPendingFlags(
  kind: ArJournalKind,
  docIds: string[],
): Promise<Map<string, ArJournalPendingFlag>> {
  if (docIds.length === 0) return new Map();
  const idSet = new Set(docIds);
  const notifications = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const flags = new Map<string, ArJournalPendingFlag>();
  for (const n of notifications) {
    const m = n.metadata as
      | { docId?: string; kind?: string; reason?: string | null; role?: string | null }
      | null;
    if (m === null) continue;
    const docId = m.docId;
    if (m.kind !== kind || docId === undefined || !idSet.has(docId)) continue;
    if (flags.has(docId)) continue;
    flags.set(docId, { reason: m.reason ?? null, role: m.role ?? null });
  }
  return flags;
}

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
 * Delegates rather than running its own scan: the two functions answer the same question about the
 * same rows, and a second copy of the metadata matching would let the gate and the reason it
 * reports drift apart.
 */
export async function findPostableArJournalDocIds(
  kind: ArJournalKind,
  docIds: string[],
): Promise<Set<string>> {
  return new Set((await findArJournalPendingFlags(kind, docIds)).keys());
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

const FIELD_DELIVERY_SOURCE_TYPE = {
  field_delivery_revenue: "FIELD_DELIVERY_REVENUE",
  field_delivery_cogs: "FIELD_DELIVERY_COGS",
} as const;

/**
 * Whether the receivable detail page should still show the journal-pending banner for one delivery
 * journal kind: flagged (the retry gate, unchanged) AND no journal posted for it.
 *
 * The flag alone cannot drive the banner. `JOURNAL_PENDING` rows are append-only, so after a retry
 * that posts the journal the gate still reads "still pending", and the banner would never clear.
 * The journal's own existence is the only signal that the retry landed. It is NEVER the gate on its
 * own: a backfilled delivery has no journal either, and the flag is what proves a post was attempted.
 */
export async function isFieldDeliveryJournalStillPending(
  kind: keyof typeof FIELD_DELIVERY_SOURCE_TYPE,
  deliveryId: string,
): Promise<boolean> {
  if (!(await isArJournalRetryable(kind, deliveryId))) return false;
  const posted = await prisma.journal.findFirst({
    where: { sourceType: FIELD_DELIVERY_SOURCE_TYPE[kind], sourceId: deliveryId },
    select: { id: true },
  });
  return posted === null;
}
