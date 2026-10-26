import { prisma } from "@elorae/db";

/** The flat `metadata` shape every `JOURNAL_PENDING` writer files; each flagger reads the keys it owns. */
export type JournalPendingMetadata = {
  docId?: string;
  orderId?: string;
  kind?: string;
  reason?: string;
};

/**
 * True when ANY `JOURNAL_PENDING` row, read or unread, matches. One uncapped read of the
 * indexed `category` column selecting only `metadata`, matched in JS: this MariaDB adapter's
 * JSON-path filtering is unreliable, so the match cannot live in the query. Neither a row cap
 * nor an unread filter is applied on purpose: a cap lets a matching row fall out of the window
 * once enough newer rows pile up, and an unread filter re-files a row the moment an operator
 * opens the bell, so a post that keeps failing would re-announce itself every tick.
 */
export async function hasJournalPendingRow(match: (metadata: JournalPendingMetadata) => boolean): Promise<boolean> {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { metadata: true },
  });
  return rows.some((row) => {
    const metadata = row.metadata as JournalPendingMetadata | null;
    return metadata != null && match(metadata);
  });
}
