export type LeadTimeType = "FIXED" | "PER_QTY";

/** A chain step after merging template defaults with supplier overrides */
export interface ResolvedStep {
  seq: number;
  name: string;
  type: LeadTimeType;
  days: number;
  rateQty: number | null;
}

/** One entry in PurchaseOrder.chainSnapshot */
export interface SnapshotStep extends ResolvedStep {
  qty: number | null;
  computedDays: number;
}

export interface ExpectedPosition {
  status: "NOT_STARTED" | "IN_PROGRESS" | "PAST_DUE";
  stepIndex: number | null;
  stepName: string | null;
  dayInStep: number | null;
  elapsedDays: number;
  totalDays: number;
  overdueDays: number;
}

export interface SupplierProcessWithTemplate {
  sequence: number;
  overrideDays: number | null;
  overrideRateQty: number | null;
  processTemplate: {
    name: string;
    leadTimeType: LeadTimeType;
    days: number;
    rateQty: number | null;
    isActive: boolean;
  };
}

/**
 * FIXED  → days.
 * PER_QTY → ceil(qty / rateQty) × days, minimum 1 batch.
 *   qty null/0/negative → treat as 1 batch (minimum charge).
 *   rateQty null/0 on a PER_QTY step → data error; fall back to 1 batch (= days).
 */
export function computeStepDays(step: ResolvedStep, qty: number | null): number {
  if (step.type === "FIXED") return step.days;
  const rate = step.rateQty && step.rateQty > 0 ? step.rateQty : null;
  if (!rate) {
    console.warn("[leadtime] PER_QTY step missing rateQty; falling back to 1 batch", step.name);
    return step.days;
  }
  const q = qty && qty > 0 ? qty : rate;
  return Math.ceil(q / rate) * step.days;
}

/**
 * Input: SupplierProcess rows (with included processTemplate), sorted by sequence.
 * Skip steps whose template.isActive is false.
 */
export function resolveChain(rows: SupplierProcessWithTemplate[]): ResolvedStep[] {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  const resolved: ResolvedStep[] = [];
  let seq = 1;
  for (const row of sorted) {
    if (!row.processTemplate.isActive) {
      console.warn(
        "[leadtime] chain references archived process; skipping",
        row.processTemplate.name
      );
      continue;
    }
    resolved.push({
      seq,
      name: row.processTemplate.name,
      type: row.processTemplate.leadTimeType,
      days: row.overrideDays ?? row.processTemplate.days,
      rateQty: row.overrideRateQty ?? row.processTemplate.rateQty,
    });
    seq += 1;
  }
  return resolved;
}

/**
 * Freeze a resolved chain for a specific PO.
 * qty = pcs-denominated PO total (or null/0 → PER_QTY uses 1-batch min).
 */
export function buildChainSnapshot(
  chain: ResolvedStep[],
  qty: number | null
): { snapshot: SnapshotStep[]; totalDays: number } {
  const snapshot: SnapshotStep[] = chain.map((step) => {
    const computedDays = computeStepDays(step, qty);
    return {
      ...step,
      qty: step.type === "PER_QTY" ? (qty && qty > 0 ? qty : null) : null,
      computedDays,
    };
  });
  const totalDays = snapshot.reduce((sum, s) => sum + s.computedDays, 0);
  return { snapshot, totalDays };
}

/**
 * Inclusive ETA: last calendar day of the chain window = poDate + (totalDays - 1).
 * totalDays <= 0 → return poDate unchanged.
 */
export function suggestEta(poDate: Date, totalDays: number): Date {
  if (totalDays <= 0) return new Date(poDate.getTime());
  const result = new Date(poDate.getFullYear(), poDate.getMonth(), poDate.getDate());
  result.setDate(result.getDate() + (totalDays - 1));
  return result;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function wholeDaysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Where the PO should be based on elapsed calendar days.
 * Chain of totalDays occupies elapsed [0, totalDays).
 */
export function getExpectedPosition(
  snapshot: SnapshotStep[],
  poCreatedAt: Date,
  now: Date
): ExpectedPosition {
  const totalDays = snapshot.reduce((sum, s) => sum + s.computedDays, 0);
  const elapsedDays = wholeDaysBetween(poCreatedAt, now);

  if (elapsedDays < 0) {
    return {
      status: "NOT_STARTED",
      stepIndex: null,
      stepName: null,
      dayInStep: null,
      elapsedDays,
      totalDays,
      overdueDays: 0,
    };
  }

  if (totalDays <= 0 || elapsedDays >= totalDays) {
    return {
      status: "PAST_DUE",
      stepIndex: null,
      stepName: null,
      dayInStep: null,
      elapsedDays,
      totalDays,
      overdueDays: totalDays <= 0 ? elapsedDays + 1 : elapsedDays - totalDays + 1,
    };
  }

  let cum = 0;
  for (let i = 0; i < snapshot.length; i++) {
    const stepDays = snapshot[i].computedDays;
    if (elapsedDays < cum + stepDays) {
      return {
        status: "IN_PROGRESS",
        stepIndex: i,
        stepName: snapshot[i].name,
        dayInStep: elapsedDays - cum + 1,
        elapsedDays,
        totalDays,
        overdueDays: 0,
      };
    }
    cum += stepDays;
  }

  return {
    status: "PAST_DUE",
    stepIndex: null,
    stepName: null,
    dayInStep: null,
    elapsedDays,
    totalDays,
    overdueDays: elapsedDays - totalDays + 1,
  };
}

/**
 * Compare confirmed vs expected. Positive lag = reality is behind the math.
 * confirmedIndex null → no signal.
 */
export function getPositionDrift(
  expected: ExpectedPosition,
  confirmedIndex: number | null
): { lagSteps: number | null; isBehind: boolean } {
  if (confirmedIndex == null || expected.stepIndex == null) {
    return { lagSteps: null, isBehind: false };
  }
  const lagSteps = expected.stepIndex - confirmedIndex;
  return { lagSteps, isBehind: lagSteps > 0 };
}

/** Whole calendar days from PO creation to first GRN. Minimum 0. */
export function computeActualLeadDays(poCreatedAt: Date, grnDate: Date): number {
  const days = wholeDaysBetween(poCreatedAt, grnDate);
  if (days < 0) {
    console.warn("[leadtime] grnDate before poCreatedAt; clamping actualLeadDays to 0");
    return 0;
  }
  return days;
}

/** Sum of FIXED effective days + 1 batch for each PER_QTY (browse-time card total). */
export function totalDaysFixedOnly(chain: ResolvedStep[]): number {
  return chain.reduce((sum, step) => sum + computeStepDays(step, null), 0);
}

export interface PcsQtyLine {
  qty: number;
  uomCode?: string | null;
  itemType?: string | null;
}

/**
 * Pcs-denominated qty for PER_QTY scaling.
 * Include line if UOM code is PCS OR item type is FINISHED_GOOD | ACCESSORIES.
 */
export function sumPcsQty(lines: PcsQtyLine[]): number {
  return lines.reduce((sum, line) => {
    const code = (line.uomCode ?? "").toUpperCase();
    const type = line.itemType ?? "";
    const isPcs =
      code === "PCS" || type === "FINISHED_GOOD" || type === "ACCESSORIES";
    if (!isPcs) return sum;
    const q = Number(line.qty);
    return sum + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
}
