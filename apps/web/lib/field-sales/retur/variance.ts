/**
 * Deliberately import-free. `isSettled` is consumed by a "use client" component (Task 6's UI),
 * and any import here — even a transitive one through something like `@/lib/db/tx-retry` —
 * would drag its whole module graph, including `@elorae/db` (Prisma + the mariadb driver),
 * into the browser bundle. Keep it that way: no imports, ever.
 */

const SETTLING = new Set(["SALESMAN_BEARS", "WRITE_OFF", "ACCEPT_SURPLUS"]);

/**
 * Liability is recorded in units, never money — a resolution says who bears the piece count
 * discrepancy, not what it is worth.
 */
export function lineVariance(claimedQty: number, receivedQty: number | null): number {
  if (receivedQty === null) return 0;
  return receivedQty - claimedQty;
}

/**
 * INVESTIGATE is deliberately NOT settling. The card lists it as one of three resolution
 * options, but its own wording is "hold for re-check with store" — it records that someone is
 * going to look, and settles nothing. A line on that path keeps the retur in
 * MISMATCH_PENDING_RESOLUTION indefinitely, by design.
 */
export function isSettled(type: string | null): boolean {
  return type !== null && SETTLING.has(type);
}

/**
 * "Every discrepant line is settled" in one place, shared by resolveFieldReturnLine (recomputes
 * the retur's status after every append) and approveFieldReturn (refuses approval unless this
 * already holds). Two copies of this rule agreeing today is exactly the shape that drifts
 * later — one definition, used by both.
 */
export function allDiscrepantLinesSettled(
  lines: { qty: number; receivedQty: number | null; resolutions: { type: string | null }[] }[]
): boolean {
  return lines.every((l) => {
    if (lineVariance(l.qty, l.receivedQty) === 0) return true;
    return isSettled(l.resolutions[0]?.type ?? null);
  });
}
