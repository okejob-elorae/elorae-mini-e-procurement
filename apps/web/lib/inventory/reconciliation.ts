import type { ReconAction, ReconDirection } from "@elorae/db";
import { Decimal } from "decimal.js";

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

export function applyDirection(
  direction: ReconDirection,
  eloraeQty: number,
  jubelioQty: number,
): { newEloraeQty: number; needsPush: boolean } {
  switch (direction) {
    case "MATCH_JUBELIO":
      return { newEloraeQty: jubelioQty, needsPush: false };
    case "REASSERT_ELORAE":
      return { newEloraeQty: eloraeQty, needsPush: true };
    default: {
      const _never: never = direction;
      return _never;
    }
  }
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
