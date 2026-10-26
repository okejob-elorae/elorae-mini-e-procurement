import { prisma } from "@elorae/db";

/** The flat `metadata` shape every `JOURNAL_PENDING` writer files; each flagger reads the keys it owns. */
export type JournalPendingMetadata = {
  docId?: string;
  orderId?: string;
  kind?: string;
  reason?: string;
};

export type JournalPendingReadOptions = {
  /**
   * True ignores rows an operator has already read, so a failure that recurs after the alert was
   * opened files a fresh one. False (default) matches read and unread rows alike.
   */
  unreadOnly?: boolean;
};

/**
 * The `metadata` of every `JOURNAL_PENDING` row, in one uncapped read of the indexed `category`
 * column. Matching happens in JS: this MariaDB adapter's JSON-path filtering is unreliable, so the
 * match cannot live in the query. No row cap on purpose: a cap lets a matching row fall out of the
 * window once enough newer rows pile up.
 */
export async function listJournalPendingMetadata(
  opts: JournalPendingReadOptions = {},
): Promise<JournalPendingMetadata[]> {
  const rows = await prisma.adminNotification.findMany({
    where: opts.unreadOnly ? { category: "JOURNAL_PENDING", readAt: null } : { category: "JOURNAL_PENDING" },
    select: { metadata: true },
  });
  return rows.map((row) => row.metadata as JournalPendingMetadata | null).filter((m): m is JournalPendingMetadata => m != null);
}

/**
 * True when a `JOURNAL_PENDING` row matches. With `unreadOnly` an operator who has read the alert
 * is re-alerted by the next failure with the same identity; without it a read row still suppresses,
 * which is what a sweep needs so a post that keeps failing does not re-announce itself every tick.
 */
export async function hasJournalPendingRow(
  match: (metadata: JournalPendingMetadata) => boolean,
  opts: JournalPendingReadOptions = {},
): Promise<boolean> {
  return (await listJournalPendingMetadata(opts)).some(match);
}
