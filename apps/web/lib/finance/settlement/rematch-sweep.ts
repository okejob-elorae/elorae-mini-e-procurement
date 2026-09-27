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
 * Rematches every settlement whose stamped resync batch has finished. Stamping first (a CAS on
 * `resyncRematchedAt: null`) keeps two ticks from rematching the same settlement twice. A RECONCILED
 * settlement is stamped but never rematched: `matchSettlement` would set it back to MATCHED and
 * rewrite the cost and profit figures its posted journal was built from.
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
    select: { id: true, status: true, resyncBatchId: true },
  });

  let rematched = 0;
  let skippedReconciled = 0;
  let stillRunning = 0;
  for (const s of pending) {
    const batchId = s.resyncBatchId as string;
    // `total === 0` counts as still running on purpose: the api seeds rows asynchronously and
    // could lag a moment behind the stamp.
    const [total, inFlight] = await Promise.all([
      prisma.jubelioSalesOrderResync.count({ where: { batchId } }),
      prisma.jubelioSalesOrderResync.count({ where: { batchId, status: { in: [...IN_FLIGHT] } } }),
    ]);
    if (total === 0 || inFlight > 0) {
      stillRunning += 1;
      continue;
    }

    const claimed = await prisma.settlement.updateMany({
      where: { id: s.id, resyncBatchId: batchId, resyncRematchedAt: null },
      data: { resyncRematchedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    if (s.status === "RECONCILED") {
      skippedReconciled += 1;
      continue;
    }

    try {
      await matchSettlement(s.id);
      rematched += 1;
    } catch (err) {
      // One settlement's match failure must not stop the sweep, and must not leave it stranded
      // stamped-but-unmatched forever — clear the stamp so the next tick retries it.
      console.error(`[rematch-sweep] matchSettlement failed for settlement ${s.id}:`, err);
      await prisma.settlement.update({
        where: { id: s.id },
        data: { resyncRematchedAt: null },
      });
    }
  }

  return { scanned: pending.length, rematched, skippedReconciled, stillRunning };
}
