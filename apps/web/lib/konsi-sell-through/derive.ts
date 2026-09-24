export type SellThroughMethodValue = "SPG_POS" | "SHELF_COUNT";
export type SellThroughResolutionValue = "BILL" | "SHRINKAGE" | "BILL_POS" | "REDUCE";

/* The one spelling of the valid resolution arms — writer.ts and the server actions both validate against this instead of each keeping its own copy. */
export const SELL_THROUGH_RESOLUTIONS = ["BILL", "SHRINKAGE", "BILL_POS", "REDUCE"] as const satisfies readonly SellThroughResolutionValue[];
export type LedgerRow = { itemId: string; variantSku: string; qty: number; refType: string; refId: string };
export type OpeningFigure = { itemId: string; variantSku: string; qty: number };
export type CountedFigure = {
  itemId: string;
  variantSku: string;
  countedQty: number | null;
  cause: "SHRINKAGE" | "UNRECORDED_SALE" | null;
};
/* A per-key difference carried in from the previous report's period — see late.ts. Signed; added into the bucket like a ledger row already classified. */
export type LateMovement = { itemId: string; variantSku: string; inQty: number; outQty: number; posSold: number; gap: number };
export type DerivedLine = {
  itemId: string;
  variantSku: string;
  openingQty: number;
  inQty: number;
  outQty: number;
  posSoldQty: number;
  gapQty: number;
  closingQty: number;
  countedQty: number | null;
  billedQty: number;
  shrinkageQty: number;
  negativeSold: boolean;
  suggestedResolution: SellThroughResolutionValue | null;
  lateInQty: number;
  lateOutQty: number;
  latePosSoldQty: number;
  lateGapQty: number;
  hasLateMovements: boolean;
};

export class UnknownLedgerRefTypeError extends Error {
  constructor(readonly refType: string) {
    super(`Unknown store ledger refType: ${refType}`);
    this.name = "UnknownLedgerRefTypeError";
  }
}

export class InvalidResolutionError extends Error {
  constructor(readonly reason: "WRONG_ARM" | "REASON_REQUIRED" | "NOT_HELD") {
    super(`Invalid sell-through resolution: ${reason}`);
    this.name = "InvalidResolutionError";
  }
}

export function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

type Bucket = {
  opening: number;
  inQty: number;
  outQty: number;
  posSold: number;
  gap: number;
  lateIn: number;
  lateOut: number;
  latePosSold: number;
  lateGap: number;
};

/**
 * Deliberately import-free — a client component may import it for a preview. Every store-side
 * movement refType is classified explicitly; anything else refuses rather than being ignored,
 * because the refType registry is exhaustive over the union and NOT over the column.
 * `lateMovements` are added into their key's figures before closing and billing are computed, and
 * are also reported apart as the `late*` figures, so a key present only there still becomes a line.
 */
export function deriveSellThroughLines(input: {
  method: SellThroughMethodValue;
  openings: OpeningFigure[];
  rows: LedgerRow[];
  counted: CountedFigure[];
  lateMovements?: LateMovement[];
}): DerivedLine[] {
  const keyOf = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;
  const buckets = new Map<string, Bucket & { itemId: string; variantSku: string }>();
  const bucket = (itemId: string, variantSku: string) => {
    const key = keyOf(itemId, variantSku);
    let b = buckets.get(key);
    if (!b) {
      b = { itemId, variantSku, opening: 0, inQty: 0, outQty: 0, posSold: 0, gap: 0, lateIn: 0, lateOut: 0, latePosSold: 0, lateGap: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const o of input.openings) bucket(o.itemId, o.variantSku).opening += o.qty;
  for (const r of input.rows) {
    const b = bucket(r.itemId, r.variantSku);
    switch (r.refType) {
      case "OpeningBalance":
        b.opening += r.qty;
        break;
      case "KonsiTransfer":
        b.inQty += r.qty;
        break;
      case "StoreTransfer":
        if (r.qty >= 0) b.inQty += r.qty;
        else b.outQty += -r.qty;
        break;
      case "FieldReturn":
        b.outQty += -r.qty;
        break;
      case "SpgSale":
        b.posSold += -r.qty;
        break;
      case "StoreStocktake":
        b.gap += -r.qty;
        break;
      default:
        throw new UnknownLedgerRefTypeError(r.refType);
    }
  }
  for (const l of input.lateMovements ?? []) {
    const b = bucket(l.itemId, l.variantSku);
    b.inQty += l.inQty;
    b.outQty += l.outQty;
    b.posSold += l.posSold;
    b.gap += l.gap;
    b.lateIn += l.inQty;
    b.lateOut += l.outQty;
    b.latePosSold += l.posSold;
    b.lateGap += l.gap;
  }
  const countedByKey = new Map(input.counted.map((c) => [keyOf(c.itemId, c.variantSku), c]));
  for (const c of input.counted) bucket(c.itemId, c.variantSku);

  const lines: DerivedLine[] = [];
  for (const [key, b] of buckets) {
    const counted = countedByKey.get(key) ?? null;
    const openingQty = roundQty(b.opening);
    const inQty = roundQty(b.inQty);
    const outQty = roundQty(b.outQty);
    const posSoldQty = roundQty(b.posSold);
    const gapQty = roundQty(b.gap);
    const closingQty = roundQty(openingQty + inQty - outQty - posSoldQty - gapQty);
    const countedQty = counted?.countedQty ?? null;
    const lateInQty = roundQty(b.lateIn);
    const lateOutQty = roundQty(b.lateOut);
    const latePosSoldQty = roundQty(b.latePosSold);
    const lateGapQty = roundQty(b.lateGap);
    const hasLateMovements = lateInQty !== 0 || lateOutQty !== 0 || latePosSoldQty !== 0 || lateGapQty !== 0;
    /* A line whose totals net to zero still stays while it carries late figures: dropping it would lose them, and the next report would then re-carry its window as late. */
    if (openingQty === 0 && inQty === 0 && outQty === 0 && posSoldQty === 0 && gapQty === 0 && closingQty === 0 && countedQty === null && !hasLateMovements) continue;

    let billedQty: number;
    let negativeSold = false;
    let suggestedResolution: SellThroughResolutionValue | null = null;
    if (input.method === "SHELF_COUNT") {
      const raw = roundQty(openingQty + inQty - outQty - closingQty);
      negativeSold = raw < 0;
      billedQty = Math.max(raw, 0);
    } else {
      billedQty = posSoldQty;
      if (gapQty > 0 && counted?.cause === "UNRECORDED_SALE") suggestedResolution = "BILL";
      if (gapQty > 0 && counted?.cause === "SHRINKAGE") suggestedResolution = "SHRINKAGE";
    }
    lines.push({
      itemId: b.itemId,
      variantSku: b.variantSku,
      openingQty,
      inQty,
      outQty,
      posSoldQty,
      gapQty,
      closingQty,
      countedQty,
      billedQty,
      shrinkageQty: 0,
      negativeSold,
      suggestedResolution,
      lateInQty,
      lateOutQty,
      latePosSoldQty,
      lateGapQty,
      hasLateMovements,
    });
  }
  return lines.sort((a, b) => (a.itemId === b.itemId ? a.variantSku.localeCompare(b.variantSku) : a.itemId.localeCompare(b.itemId)));
}

export function isLineHeld(
  line: { gapQty: number; resolution: SellThroughResolutionValue | null },
  method: SellThroughMethodValue,
): boolean {
  return method === "SPG_POS" && line.gapQty !== 0 && line.resolution === null;
}

/**
 * The one spelling of which resolution arms a gap's sign allows — a shortfall (gap > 0) can only
 * be BILLed or written off as SHRINKAGE, a surplus (gap < 0) can only be billed at BILL_POS or
 * REDUCEd, and a zero gap has no arm at all. `applyResolution`'s WRONG_ARM check and the backoffice
 * detail screen's `Select` both read this instead of each keeping its own copy.
 */
export function resolutionArmsFor(gapQty: number): readonly SellThroughResolutionValue[] {
  if (gapQty > 0) return ["BILL", "SHRINKAGE"];
  if (gapQty < 0) return ["BILL_POS", "REDUCE"];
  return [];
}

/* The one spelling of which arms need a written reason — SHRINKAGE and REDUCE both write off value, BILL and BILL_POS don't. */
export function resolutionNeedsReason(resolution: SellThroughResolutionValue): boolean {
  return resolution === "SHRINKAGE" || resolution === "REDUCE";
}

export function applyResolution(
  line: { posSoldQty: number; gapQty: number },
  method: SellThroughMethodValue,
  resolution: SellThroughResolutionValue,
  reason: string | null,
): { billedQty: number; shrinkageQty: number; resolutionReason: string | null } {
  if (method !== "SPG_POS" || line.gapQty === 0) throw new InvalidResolutionError("NOT_HELD");
  if (!resolutionArmsFor(line.gapQty).includes(resolution)) throw new InvalidResolutionError("WRONG_ARM");
  const trimmed = reason?.trim() ?? "";
  const needsReason = resolutionNeedsReason(resolution);
  if (needsReason && trimmed === "") throw new InvalidResolutionError("REASON_REQUIRED");
  const resolutionReason = needsReason ? trimmed : trimmed === "" ? null : trimmed;
  switch (resolution) {
    case "BILL":
      return { billedQty: roundQty(line.posSoldQty + line.gapQty), shrinkageQty: 0, resolutionReason };
    case "SHRINKAGE":
      return { billedQty: line.posSoldQty, shrinkageQty: line.gapQty, resolutionReason };
    case "BILL_POS":
      return { billedQty: line.posSoldQty, shrinkageQty: 0, resolutionReason };
    case "REDUCE":
      return { billedQty: Math.max(roundQty(line.posSoldQty + line.gapQty), 0), shrinkageQty: 0, resolutionReason };
  }
}
