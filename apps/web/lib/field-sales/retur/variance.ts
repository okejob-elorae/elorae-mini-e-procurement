/**
 * Deliberately import-free. `isSettled` is consumed by a "use client" component (Task 6's UI),
 * and any import here — even a transitive one through something like `@/lib/db/tx-retry` —
 * would drag its whole module graph, including `@elorae/db` (Prisma + the mariadb driver),
 * into the browser bundle. Keep it that way: no imports, ever.
 */

const SETTLING = new Set(["SALESMAN_BEARS", "WRITE_OFF", "ACCEPT_SURPLUS"]);

/** Resolution types that settle a SHORTAGE line (variance < 0). INVESTIGATE settles neither direction, but is a valid pick on both. */
const SHORTAGE_RESOLUTION_TYPES = new Set(["SALESMAN_BEARS", "WRITE_OFF", "INVESTIGATE"]);
/** Resolution types that settle an OVER line (variance > 0). */
const SURPLUS_RESOLUTION_TYPES = new Set(["ACCEPT_SURPLUS", "INVESTIGATE"]);

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
 * Direction rule (decision D4): only SALESMAN_BEARS/WRITE_OFF settle a SHORTAGE line, and only
 * ACCEPT_SURPLUS settles an OVER line. INVESTIGATE is valid in either direction — it settles
 * nothing, so it never conflicts with the shortage/surplus split. `variance` must already be
 * non-zero; a zero-variance line has no direction to check against.
 */
export function isValidResolutionDirection(type: string, variance: number): boolean {
  if (variance < 0) return SHORTAGE_RESOLUTION_TYPES.has(type);
  if (variance > 0) return SURPLUS_RESOLUTION_TYPES.has(type);
  return false;
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
