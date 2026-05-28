type DecimalLike = number | string | { toString(): string } | null | undefined;

export interface PlanningCategoryNode {
  id: string;
  parentId: string | null;
  targetQty: number | null;
  parentSharePercent: DecimalLike;
  itemId: string | null;
  parent?: Pick<PlanningCategoryNode, 'targetQty'> | null;
  children?: PlanningCategoryNode[];
}

export interface PlanningMonthlyRow {
  month: number;
  targetQty: number | null;
  isManualOverride: boolean;
}

export interface MonthlyBreakdown {
  month: number;
  targetQty: number;
  isManualOverride: boolean;
}

export interface ShareValidation {
  valid: boolean;
  totalPercent: number;
  remaining: number;
}

export interface MonthlyMismatchWarning {
  hasMismatch: boolean;
  monthlySum: number;
  effectiveTarget: number;
  delta: number;
}

export type CompletionBand = 'red' | 'yellow' | 'green';

export interface PlanActualsPrismaClient {
  fGReceipt: {
    aggregate(args: {
      where: {
        wo: {
          finishedGoodId: string;
          status: { not: 'CANCELLED' };
        };
        receivedAt: { gte: Date; lt: Date };
      };
      _sum: { qtyAccepted: true };
    }): Promise<{ _sum: { qtyAccepted: DecimalLike } }>;
  };
}

export interface FgReceiptActualRow {
  finishedGoodId: string;
  qtyAccepted: DecimalLike;
  receivedAt: Date;
}

export interface ActualsLookup {
  yearlyByItem: Map<string, number>;
  monthlyByItem: Map<string, Map<number, number>>;
}

function toNumber(value: DecimalLike): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number(value.toString());
}

export function getEffectiveTarget(category: PlanningCategoryNode): number {
  if (!category.parentId) {
    return category.targetQty ?? 0;
  }
  const parentTarget = category.parent?.targetQty ?? 0;
  const share = toNumber(category.parentSharePercent);
  return Math.round(parentTarget * (share / 100));
}

export function getMonthlyTarget(
  effectiveTarget: number,
  month: number,
  monthlyOverrides: PlanningMonthlyRow[]
): number {
  const override = monthlyOverrides.find((row) => row.month === month);
  if (override?.isManualOverride && override.targetQty != null) {
    return override.targetQty;
  }

  const manualMonths = monthlyOverrides.filter(
    (row) => row.isManualOverride && row.targetQty != null
  );
  const manualTotal = manualMonths.reduce((sum, row) => sum + (row.targetQty ?? 0), 0);
  const autoMonthCount = 12 - manualMonths.length;
  if (autoMonthCount === 0) return 0;

  const remainingTarget = effectiveTarget - manualTotal;
  const basePerMonth = Math.floor(remainingTarget / autoMonthCount);
  const remainder = remainingTarget - basePerMonth * autoMonthCount;

  const autoMonthNumbers = Array.from({ length: 12 }, (_, index) => index + 1).filter(
    (autoMonth) => !manualMonths.some((manual) => manual.month === autoMonth)
  );
  const autoIndex = autoMonthNumbers.indexOf(month);
  if (autoIndex === -1) return 0;

  return basePerMonth + (autoIndex < remainder ? 1 : 0);
}

export function getAllMonthlyTargets(
  effectiveTarget: number,
  monthlyOverrides: PlanningMonthlyRow[]
): MonthlyBreakdown[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const override = monthlyOverrides.find((row) => row.month === month);
    return {
      month,
      targetQty: getMonthlyTarget(effectiveTarget, month, monthlyOverrides),
      isManualOverride: override?.isManualOverride ?? false,
    };
  });
}

export function sumMonthlyTargets(
  effectiveTarget: number,
  monthlyOverrides: PlanningMonthlyRow[]
): number {
  return getAllMonthlyTargets(effectiveTarget, monthlyOverrides).reduce(
    (sum, row) => sum + row.targetQty,
    0
  );
}

export function checkMonthlyMismatch(
  effectiveTarget: number,
  monthlyOverrides: PlanningMonthlyRow[]
): MonthlyMismatchWarning {
  const monthlySum = sumMonthlyTargets(effectiveTarget, monthlyOverrides);
  return {
    hasMismatch: monthlySum !== effectiveTarget,
    monthlySum,
    effectiveTarget,
    delta: monthlySum - effectiveTarget,
  };
}

/** Pure share validation — pass sibling percents plus optional incoming percent. */
export function validateChildShares(
  existingShares: number[],
  incomingPercent = 0
): ShareValidation {
  const totalPercent = existingShares.reduce((sum, share) => sum + share, 0) + incomingPercent;
  return {
    valid: totalPercent <= 100,
    totalPercent,
    remaining: 100 - totalPercent,
  };
}

export function getCompletionPercent(actual: number, target: number): number {
  if (target === 0) return 0;
  return Math.round((actual / target) * 100);
}

export function getCompletionBand(percent: number): CompletionBand {
  if (percent < 50) return 'red';
  if (percent < 80) return 'yellow';
  return 'green';
}

function jakartaStartToUtc(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1, -7, 0, 0, 0));
}

export function getJakartaYearBounds(year: number): { start: Date; endExclusive: Date } {
  return {
    start: jakartaStartToUtc(year, 0),
    endExclusive: jakartaStartToUtc(year + 1, 0),
  };
}

export function getJakartaMonthBounds(
  year: number,
  month: number
): { start: Date; endExclusive: Date } {
  const monthIndex = month - 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonthIndex = month === 12 ? 0 : monthIndex + 1;
  return {
    start: jakartaStartToUtc(year, monthIndex),
    endExclusive: jakartaStartToUtc(nextMonthYear, nextMonthIndex),
  };
}

/** Build in-memory actuals map from batched FGReceipt rows (WIB month). */
export function buildActualsLookup(
  receipts: FgReceiptActualRow[],
  year: number
): ActualsLookup {
  const yearlyByItem = new Map<string, number>();
  const monthlyByItem = new Map<string, Map<number, number>>();

  for (const receipt of receipts) {
    const qty = toNumber(receipt.qtyAccepted);
    if (qty === 0) continue;

    const received = receipt.receivedAt;
    const wibMonth = new Date(received.getTime() + 7 * 60 * 60 * 1000).getUTCMonth() + 1;
    const wibYear = new Date(received.getTime() + 7 * 60 * 60 * 1000).getUTCFullYear();
    if (wibYear !== year) continue;

    yearlyByItem.set(
      receipt.finishedGoodId,
      (yearlyByItem.get(receipt.finishedGoodId) ?? 0) + qty
    );

    if (!monthlyByItem.has(receipt.finishedGoodId)) {
      monthlyByItem.set(receipt.finishedGoodId, new Map());
    }
    const monthMap = monthlyByItem.get(receipt.finishedGoodId)!;
    monthMap.set(wibMonth, (monthMap.get(wibMonth) ?? 0) + qty);
  }

  return { yearlyByItem, monthlyByItem };
}

function getLeafActualFromLookup(
  lookup: ActualsLookup,
  itemId: string | null
): number {
  if (!itemId) return 0;
  return lookup.yearlyByItem.get(itemId) ?? 0;
}

function getMonthlyLeafActualFromLookup(
  lookup: ActualsLookup,
  itemId: string | null,
  month: number
): number {
  if (!itemId) return 0;
  return lookup.monthlyByItem.get(itemId)?.get(month) ?? 0;
}

function getActualQtyInBoundsFromLookup(
  category: PlanningCategoryNode,
  lookup: ActualsLookup
): number {
  const children = category.children ?? [];
  if (children.length > 0) {
    return children.reduce(
      (sum, child) => sum + getActualQtyInBoundsFromLookup(child, lookup),
      0
    );
  }
  return getLeafActualFromLookup(lookup, category.itemId);
}

function getMonthlyActualInBoundsFromLookup(
  category: PlanningCategoryNode,
  lookup: ActualsLookup,
  month: number
): number {
  const children = category.children ?? [];
  if (children.length > 0) {
    return children.reduce(
      (sum, child) => sum + getMonthlyActualInBoundsFromLookup(child, lookup, month),
      0
    );
  }
  return getMonthlyLeafActualFromLookup(lookup, category.itemId, month);
}

export function getActualQtyFromLookup(
  category: PlanningCategoryNode,
  lookup: ActualsLookup
): number {
  return getActualQtyInBoundsFromLookup(category, lookup);
}

export function getMonthlyActualQtyFromLookup(
  category: PlanningCategoryNode,
  lookup: ActualsLookup,
  month: number
): number {
  return getMonthlyActualInBoundsFromLookup(category, lookup, month);
}

async function getLeafActualQty(
  prisma: PlanActualsPrismaClient,
  itemId: string | null,
  start: Date,
  endExclusive: Date
): Promise<number> {
  if (!itemId) return 0;
  const aggregate = await prisma.fGReceipt.aggregate({
    where: {
      wo: {
        finishedGoodId: itemId,
        status: { not: 'CANCELLED' },
      },
      receivedAt: {
        gte: start,
        lt: endExclusive,
      },
    },
    _sum: { qtyAccepted: true },
  });
  return toNumber(aggregate._sum.qtyAccepted);
}

async function getActualQtyInBounds(
  prisma: PlanActualsPrismaClient,
  category: PlanningCategoryNode,
  start: Date,
  endExclusive: Date
): Promise<number> {
  const children = category.children ?? [];
  if (children.length > 0) {
    let total = 0;
    for (const child of children) {
      total += await getActualQtyInBounds(prisma, child, start, endExclusive);
    }
    return total;
  }
  return getLeafActualQty(prisma, category.itemId, start, endExclusive);
}

export async function getActualQty(
  prisma: PlanActualsPrismaClient,
  category: PlanningCategoryNode,
  year: number
): Promise<number> {
  const { start, endExclusive } = getJakartaYearBounds(year);
  return getActualQtyInBounds(prisma, category, start, endExclusive);
}

export async function getMonthlyActualQty(
  prisma: PlanActualsPrismaClient,
  category: PlanningCategoryNode,
  year: number,
  month: number
): Promise<number> {
  const { start, endExclusive } = getJakartaMonthBounds(year, month);
  return getActualQtyInBounds(prisma, category, start, endExclusive);
}
