/**
 * Selection and batching rules for the reconciliation run's bulk MATCH_JUBELIO resolve.
 * Deliberately import-free: the run detail page, a "use client" component, imports it, and one
 * import of `@elorae/db` here would drag Prisma into the browser bundle.
 */

/** The most result ids one bulk resolve call accepts; the client sends its selection in batches of this size. */
export const RECON_BULK_BATCH_MAX = 25;

export type ReconSelectableRow = {
  id: string;
  action: string;
  eloraeQty: number;
  /** `eloraeQty − jubelioQty`, as the run stored it; `null` when Jubelio had no figure. */
  variance: number | null;
};

export type ReconQuickSelect = "ALL_FLAGGED" | "ELORAE_NEGATIVE" | "JUBELIO_HIGHER";

/**
 * The FLAGGED rows a quick-select rule picks, in the run's own order. Only FLAGGED rows are
 * resolvable. A row the snapshot had no Jubelio figure for has a null variance, so JUBELIO_HIGHER
 * never picks it; rows from runs before the nullable-figures migration still store
 * `variance = eloraeQty` and are picked when Elorae is negative. ALL_FLAGGED and ELORAE_NEGATIVE pick either. Resolving such a row re-reads the live
 * figure: refused `JUBELIO_QTY_MISSING` if Jubelio still has none, matched to it if it now has one.
 */
export function idsForQuickSelect(rows: readonly ReconSelectableRow[], rule: ReconQuickSelect): string[] {
  return rows
    .filter((row) => {
      if (row.action !== "FLAGGED") return false;
      if (rule === "ELORAE_NEGATIVE") return row.eloraeQty < 0;
      if (rule === "JUBELIO_HIGHER") return row.variance !== null && row.variance < 0;
      return true;
    })
    .map((row) => row.id);
}

export function chunkIds(ids: readonly string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}

export type ReconBulkOutcome = { success: true } | { success: false; reason: string };

export type ReconBulkSummary = {
  matched: number;
  refused: Array<{ reason: string; count: number }>;
};

/** Matched count plus refusals grouped by reason, most frequent first, ties by reason. */
export function summarizeBulkOutcomes(outcomes: readonly ReconBulkOutcome[]): ReconBulkSummary {
  let matched = 0;
  const byReason = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.success) {
      matched += 1;
    } else {
      byReason.set(outcome.reason, (byReason.get(outcome.reason) ?? 0) + 1);
    }
  }
  const refused = [...byReason.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { matched, refused };
}
