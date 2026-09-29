import type { ReconAction, ReconDirection } from "@elorae/db";
import { jubelioEndQtyFor } from "@elorae/db";
import { Decimal } from "decimal.js";

/**
 * Elorae's figure to compare against Jubelio's `end_qty` (the run's comparison, and the manual
 * resolve's moved-since check): the floored `jubelioEndQtyFor` while stock pushes are enabled,
 * mirroring what the push actually sends; raw `qtyOnHand` while they are disabled, since nothing
 * is pushed and so nothing floors Jubelio's figure for this to mirror — a negative on-hand stays
 * negative and gets flagged rather than hidden by a floor that only means something on the push
 * path. `offlineReserved` is already `0` while pushes are disabled (see `effectiveOfflineReservedQty`
 * in `packages/db/src/jubelio-stock-contract.ts`), so this only changes whether the floor applies.
 */
export function comparableEloraeQty(
  qtyOnHand: number,
  offlineReserved: number,
  pushEnabled: boolean,
): number {
  return pushEnabled ? jubelioEndQtyFor(qtyOnHand, offlineReserved) : qtyOnHand;
}

export type ReconConfigDirection = "FLAG_ONLY" | ReconDirection;

export type ClassifyResult = {
  action: ReconAction;
  needsStockWrite: boolean;
  needsPush: boolean;
};

export function classifyVariance(
  variance: number,
  threshold: number,
  direction: ReconConfigDirection,
): ClassifyResult {
  const absVar = new Decimal(variance).abs().toNumber();
  if (absVar === 0) {
    return { action: "IN_SYNC", needsStockWrite: false, needsPush: false };
  }
  if (absVar > threshold) {
    return { action: "FLAGGED", needsStockWrite: false, needsPush: false };
  }
  if (direction === "FLAG_ONLY") {
    return { action: "FLAGGED", needsStockWrite: false, needsPush: false };
  }
  if (direction === "MATCH_JUBELIO") {
    return { action: "AUTO_CORRECTED", needsStockWrite: true, needsPush: false };
  }
  if (direction === "REASSERT_ELORAE") {
    return { action: "AUTO_CORRECTED", needsStockWrite: false, needsPush: true };
  }
  const _exhaustive: never = direction;
  return _exhaustive;
}

/**
 * Why a manual resolve refused, or `UNEXPECTED` for anything else. Each code maps to
 * `stockReconciliation.err.<CODE>` in both locales — there is no exhaustive `Record` over this
 * union, so a new member needs its locale strings or the toast shows the raw key.
 */
export type ReconResolveReason =
  | "INVALID_DIRECTION"
  | "PUSH_DISABLED"
  | "NOT_FOUND"
  | "ALREADY_RESOLVED"
  | "NO_MAPPING"
  | "JUBELIO_FETCH_FAILED"
  | "JUBELIO_QTY_MISSING"
  | "JUBELIO_QTY_INVALID"
  | "NO_INVENTORY_ROW"
  | "STOCK_MOVED"
  | "UNEXPECTED";

/** Why a bulk resolve refused the whole batch before reading any row; same `stockReconciliation.err.<CODE>` keys. */
export type ReconBulkResolveReason = "INVALID_BATCH" | "BATCH_TOO_LARGE";

/** Why saving the reconciliation settings refused; same `stockReconciliation.err.<CODE>` keys. */
export type ReconSettingsReason = "PUSH_DISABLED" | "INVALID_DIRECTION";

/** Two stock quantities are the same when they agree to the 2dp the `Decimal(10,2)` columns keep. */
export function sameQty2dp(a: number, b: number): boolean {
  return new Decimal(a).toDecimalPlaces(2).equals(new Decimal(b).toDecimalPlaces(2));
}

export type ReconRowInput = {
  /** Elorae's comparable figure: on-hand minus the field-sales holds Jubelio has had netted. */
  eloraeQty: number;
  /** Jubelio's `end_qty`, or `null` when the snapshot had no usable figure for this variant. */
  jubelioQty: number | null;
  threshold: number;
  direction: ReconConfigDirection;
  pushEnabled: boolean;
};

export type ReconRowOutcome = {
  classified: ClassifyResult;
  /**
   * What the non-null `jubelioQty`/`variance` columns store. A missing Jubelio figure stores 0
   * and `variance = eloraeQty` because the columns cannot hold null; the row is always FLAGGED,
   * so that stored 0 is never compared or written.
   */
  storedJubelioQty: number;
  variance: number;
};

/**
 * Classifies one reconciliation row. A missing Jubelio figure is FLAGGED and never corrected or
 * compared as 0; REASSERT_ELORAE degrades to FLAGGED while stock pushes are disabled, so the
 * counters and the stored action match what actually ran.
 */
export function classifyReconRow(input: ReconRowInput): ReconRowOutcome {
  if (input.jubelioQty === null) {
    return {
      classified: { action: "FLAGGED", needsStockWrite: false, needsPush: false },
      storedJubelioQty: 0,
      variance: input.eloraeQty,
    };
  }
  const variance = new Decimal(input.eloraeQty).minus(input.jubelioQty).toDecimalPlaces(2).toNumber();
  let classified = classifyVariance(variance, input.threshold, input.direction);
  if (classified.needsPush && !input.pushEnabled) {
    classified = { action: "FLAGGED", needsStockWrite: false, needsPush: false };
  }
  return { classified, storedJubelioQty: input.jubelioQty, variance };
}

export function parseReconThreshold(value: string | undefined): number {
  const n = Number(value ?? "0");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseReconDirection(value: string | undefined): ReconConfigDirection {
  if (value === "MATCH_JUBELIO" || value === "REASSERT_ELORAE" || value === "FLAG_ONLY") {
    return value;
  }
  return "FLAG_ONLY";
}

export function isCronEnabled(value: string | undefined): boolean {
  return (value ?? "true").toLowerCase() !== "false";
}
