import { prisma } from "@elorae/db";
import { matchSettlement } from "./match";

const IN_FLIGHT = ["PENDING", "RESOLVING", "FETCHING"] as const;

export type RematchSweepResult = {
  scanned: number;
  rematched: number;
  skippedReconciled: number;
  stillRunning: number;
};

/**
 * Rematches every settlement whose stamped resync batch has finished, then stamps
 * `resyncRematchedAt` with a CAS on the same batch. Matching comes FIRST and the stamp LAST, so a
 * `matchSettlement` throw, or a restart between the two, leaves the settlement unstamped and the
 * next tick retries it; `matchSettlement` is idempotent, so a repeat only wastes work. The cron
 * job runs with `noOverlap`, so two ticks never race each other in one process.
 *
 * A RECONCILED settlement is stamped but never rematched: `matchSettlement` would rewrite every
 * line's cost and profit figures after the journal posted. The status is re-read AFTER the batch
 * is found finished, never taken from the `findMany` below, so a journal posted while this tick
 * was counting is still honoured.
 *
 * `settlementIds` must always be passed by a spec — omitted, this sweeps every settlement with a
 * pending batch; `[]` sweeps nothing (`!== undefined`, never a length check — see AGENTS.md's
 * optional-array landmine).
 */
export async function runSettlementRematchSweep(
  opts: { settlementIds?: string[] } = {},
): Promise<RematchSweepResult> {
  const pending = await prisma.settlement.findMany({
    where: {
      resyncBatchId: { not: null },
      resyncRematchedAt: null,
      ...(opts.settlementIds !== undefined ? { id: { in: opts.settlementIds } } : {}),
    },
    select: { id: true, resyncBatchId: true },
  });

  let rematched = 0;
  let skippedReconciled = 0;
  let stillRunning = 0;
  for (const s of pending) {
    const batchId = s.resyncBatchId as string;
    /**
     * `total === 0` counts as still running on purpose. The api writes every row before it returns
     * the batch and the stamp lands only after that, so a stamped batch has rows today; with none,
     * "finished with nothing fetched" and "not visible yet" look the same, and this declines to guess.
     */
    const [total, inFlight] = await Promise.all([
      prisma.jubelioSalesOrderResync.count({ where: { batchId } }),
      prisma.jubelioSalesOrderResync.count({ where: { batchId, status: { in: [...IN_FLIGHT] } } }),
    ]);
    if (total === 0 || inFlight > 0) {
      stillRunning += 1;
      continue;
    }

    const current = await prisma.settlement.findUnique({
      where: { id: s.id },
      select: { status: true, resyncBatchId: true, resyncRematchedAt: true },
    });
    /* Replaced by a later press, or already stamped since the `findMany` — nothing left for this batch. */
    if (!current || current.resyncBatchId !== batchId || current.resyncRematchedAt !== null) continue;

    if (current.status === "RECONCILED") {
      if (await stampBatch(s.id, batchId)) skippedReconciled += 1;
      continue;
    }

    try {
      await matchSettlement(s.id);
    } catch (err) {
      /* Left unstamped on purpose: the next tick retries it. */
      console.error(`[rematch-sweep] matchSettlement failed for settlement ${s.id}:`, err);
      continue;
    }
    if (await stampBatch(s.id, batchId)) rematched += 1;
  }

  return { scanned: pending.length, rematched, skippedReconciled, stillRunning };
}

/**
 * The stamp CAS, scoped to the batch this tick counted. A batch replaced by a later Resync press
 * claims nothing here, so the newer batch stays unstamped for its own tick to finish.
 */
async function stampBatch(settlementId: string, batchId: string): Promise<boolean> {
  const claimed = await prisma.settlement.updateMany({
    where: { id: settlementId, resyncBatchId: batchId, resyncRematchedAt: null },
    data: { resyncRematchedAt: new Date() },
  });
  return claimed.count > 0;
}
