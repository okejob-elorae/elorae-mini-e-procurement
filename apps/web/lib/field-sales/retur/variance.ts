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

/**
 * Credited quantity is NEITHER the received qty NOR the claimed qty. It is derived from the
 * line's variance and its latest resolution:
 *
 *   no variance                -> received (equal to claimed)
 *   short + SALESMAN_BEARS     -> claimed   (the store sent what its paper says; the shortfall
 *                                            is the salesman's debt, not the store's problem)
 *   short + WRITE_OFF          -> claimed   (a company loss only exists if we credited goods we
 *                                            never received)
 *   surplus + ACCEPT_SURPLUS   -> received  (we hold the goods and they re-enter sellable stock)
 *   anything else              -> null      (not creditable yet)
 *
 * DO NOT collapse this to Math.max(claimed, received). Every row above happens to be the larger
 * of the two numbers, and that is a coincidence of four independent business decisions, not a
 * rule anyone chose. A Math.max would pass every test in this file while being wrong the moment
 * a fifth resolution type lands or one of these four is revisited — and it would be wrong
 * silently, in money, on a document a store owner reads.
 */
export function creditedQtyForLine(line: {
  qty: number;
  receivedQty: number | null;
  latestResolutionType: "SALESMAN_BEARS" | "INVESTIGATE" | "WRITE_OFF" | "ACCEPT_SURPLUS" | null;
}): number | null {
  if (line.receivedQty === null) return null;

  const variance = lineVariance(line.qty, line.receivedQty);
  if (variance === 0) return line.receivedQty;

  if (variance < 0) {
    if (line.latestResolutionType === "SALESMAN_BEARS") return line.qty;
    if (line.latestResolutionType === "WRITE_OFF") return line.qty;
    return null;
  }

  if (line.latestResolutionType === "ACCEPT_SURPLUS") return line.receivedQty;
  return null;
}
