import type { Prisma } from "@elorae/db";

/**
 * Locks one marketplace `Settlement` row with `SELECT … FOR UPDATE` and returns its status as of
 * the lock, or `null` when the row does not exist. A locking read sees the latest committed row,
 * not the transaction's snapshot, so a caller must decide on the status returned here and take
 * this lock before any other read in its transaction. A caller-supplied transaction client must
 * not have read before calling: a locking read after an earlier consistent read can raise
 * ER_CHECKREAD under `innodb_snapshot_isolation` on newer MariaDB.
 *
 * `matchSettlement` and `postSettlementJournal` both take it first, which is what serialises a
 * match against the journal post; both lock the settlement before anything else, so the pair
 * cannot deadlock on lock order.
 */
export async function lockSettlementRow(
  tx: Prisma.TransactionClient,
  settlementId: string,
): Promise<{ status: string } | null> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT \`status\` FROM \`Settlement\` WHERE \`id\` = ${settlementId} FOR UPDATE
  `;
  const row = rows[0];
  return row ? { status: row.status } : null;
}
