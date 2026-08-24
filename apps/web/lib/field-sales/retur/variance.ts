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
