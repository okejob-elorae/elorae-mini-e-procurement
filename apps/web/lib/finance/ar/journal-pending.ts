import { prisma } from "@elorae/db";
import { JENIS_TERTUNDA_LAPANGAN, SUMBER_LAPANGAN, SUMBER_NOTA_LAMA } from "@/lib/finance/lapangan/aturan";
import type { ArJournalKind } from "./post-ar-journal-safely";

export type ArJournalPendingFlag = { reason: string | null; role: string | null };

/**
 * The `kind` the nota engine files its own failures under (`lib/finance/lapangan/tertunda.ts`). A
 * delivery's journal is the nota journal, so a `nota_putus` flag is as much evidence of a failed
 * delivery post as the older `field_delivery_revenue` one.
 */
export const NOTA_JOURNAL_PENDING_KIND = JENIS_TERTUNDA_LAPANGAN[SUMBER_LAPANGAN.NOTA];

type PendingMetadata = { docId?: string; kind?: string; reason?: string | null; role?: string | null };

/* JSON can arrive as text on this adapter; it is read the same either way. */
function metadataOf(value: unknown): PendingMetadata | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as PendingMetadata) : null;
}

async function findPendingFlags(kinds: ReadonlySet<string>, docIds: string[]): Promise<Map<string, ArJournalPendingFlag>> {
  if (docIds.length === 0) return new Map();
  const idSet = new Set(docIds);
  const notifications = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const flags = new Map<string, ArJournalPendingFlag>();
  for (const n of notifications) {
    const m = metadataOf(n.metadata);
    if (m === null) continue;
    const docId = m.docId;
    if (m.kind === undefined || !kinds.has(m.kind) || docId === undefined || !idSet.has(docId)) continue;
    if (flags.has(docId)) continue;
    flags.set(docId, { reason: m.reason ?? null, role: m.role ?? null });
  }
  return flags;
}

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
  return findPendingFlags(new Set([kind]), docIds);
}

/**
 * `findArJournalPendingFlags` across several kinds, including the field-journal kinds the
 * `lib/finance/lapangan` engine files (`JENIS_TERTUNDA_LAPANGAN`), which are not `ArJournalKind`s.
 */
export async function findJournalPendingFlagsOfKinds(
  kinds: readonly string[],
  docIds: string[],
): Promise<Map<string, ArJournalPendingFlag>> {
  return findPendingFlags(new Set(kinds), docIds);
}

/**
 * `findArJournalPendingFlags` for a delivery's revenue: a flag under either kind a delivery's journal
 * can fail under — `field_delivery_revenue` from the delivery/shipment actions, `nota_putus` from the
 * nota engine itself.
 */
export async function findDeliveryRevenuePendingFlags(deliveryIds: string[]): Promise<Map<string, ArJournalPendingFlag>> {
  return findJournalPendingFlagsOfKinds(["field_delivery_revenue", NOTA_JOURNAL_PENDING_KIND], deliveryIds);
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

type FieldDeliveryJournalKind = "field_delivery_revenue" | "field_delivery_cogs";

/* The flag kinds that make each delivery journal kind retryable. The nota journal carries the revenue, so its own flag gates that kind. */
const FIELD_DELIVERY_FLAG_KINDS: Record<FieldDeliveryJournalKind, ReadonlySet<string>> = {
  field_delivery_revenue: new Set<string>(["field_delivery_revenue", NOTA_JOURNAL_PENDING_KIND]),
  field_delivery_cogs: new Set<string>(["field_delivery_cogs"]),
};

/* The journals whose existence means a kind has posted: the nota journal, or that kind's half of the old pair. */
const FIELD_DELIVERY_POSTED_BY: Record<FieldDeliveryJournalKind, string[]> = {
  field_delivery_revenue: [SUMBER_LAPANGAN.NOTA, SUMBER_NOTA_LAMA.PENDAPATAN],
  field_delivery_cogs: [SUMBER_LAPANGAN.NOTA, SUMBER_NOTA_LAMA.HPP],
};

/**
 * The retry gate for one delivery journal kind: `isArJournalRetryable`, widened to the nota
 * engine's own `nota_putus` flag for the revenue kind.
 */
export async function isFieldDeliveryJournalRetryable(kind: FieldDeliveryJournalKind, deliveryId: string): Promise<boolean> {
  return (await findPendingFlags(FIELD_DELIVERY_FLAG_KINDS[kind], [deliveryId])).has(deliveryId);
}

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
  kind: FieldDeliveryJournalKind,
  deliveryId: string,
): Promise<boolean> {
  if (!(await isFieldDeliveryJournalRetryable(kind, deliveryId))) return false;
  const posted = await prisma.journal.findFirst({
    where: { sourceType: { in: FIELD_DELIVERY_POSTED_BY[kind] }, sourceId: deliveryId },
    select: { id: true },
  });
  return posted === null;
}
