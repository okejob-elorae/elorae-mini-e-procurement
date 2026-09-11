import { prisma, Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";

export type OffsettableReturnRow = {
  id: string;
  docNo: string;
  storeId: string;
  storeName: string;
  totalValue: number;
  appliedValue: number;
  remainingValue: number;
};

const OFFSETTABLE_PAGE_SIZE = 25;

function offsettableReturnWhere(storeId?: string): Prisma.FieldReturnWhereInput {
  return {
    status: "APPROVED",
    valuationStatus: "VALUED",
    offsetStatus: "AVAILABLE",
    ...(storeId ? { storeId } : {}),
  };
}

/**
 * Approved, fully-valued, not-yet-applied returns — the exact three conditions
 * `applyReturnOffset` itself enforces. Never widen this beyond `storeId` + `page`: a retur
 * cannot be hard-linked to one receivable (its lines price independently), so the store is the
 * only key that holds for every retur.
 *
 * Currently has NO production caller — the PWA settlement screen, its one caller at merge-base,
 * switched to the unpaged `listAllOffsettableReturns` below (a counter-side picker cannot lose
 * a retur to a second page). Kept, not deleted, because it is a real, independently-tested,
 * correctly-paginated query that a genuine backoffice returns list would want as-is; there is no
 * such list today. Confirm this is still true before reusing it for anything new.
 */
export async function listOffsettableReturns(
  params: { storeId?: string; page?: number } = {},
): Promise<{ rows: OffsettableReturnRow[]; total: number }> {
  const page = params.page ?? 1;
  const where = offsettableReturnWhere(params.storeId);
  const [rows, total] = await Promise.all([
    prisma.fieldReturn.findMany({
      where,
      orderBy: { approvedAt: "asc" },
      skip: (page - 1) * OFFSETTABLE_PAGE_SIZE,
      take: OFFSETTABLE_PAGE_SIZE,
      select: {
        id: true,
        docNo: true,
        storeId: true,
        totalValue: true,
        appliedValue: true,
        store: { select: { name: true } },
      },
    }),
    prisma.fieldReturn.count({ where }),
  ]);
  return {
    rows: rows.map((r) => {
      const totalValue = r.totalValue ? Number(r.totalValue) : 0;
      const appliedValue = Number(r.appliedValue);
      return {
        id: r.id,
        docNo: r.docNo,
        storeId: r.storeId,
        storeName: r.store.name,
        totalValue,
        appliedValue,
        remainingValue: roundCents(totalValue - appliedValue),
      };
    }),
    total,
  };
}

/**
 * Pure aggregate — no new table, no stored figure. A retur counts here for as long as it sits
 * AVAILABLE and contributes only what is left of it; the moment it is fully drawn down it stops
 * contributing, with no separate "consumed" ledger to keep in sync.
 */
export async function getStoreAvailableCredit(storeId: string): Promise<number> {
  const rows = await prisma.fieldReturn.findMany({
    where: offsettableReturnWhere(storeId),
    select: { totalValue: true, appliedValue: true },
  });
  return roundCents(
    rows.reduce((sum, r) => sum + (r.totalValue ? Number(r.totalValue) : 0) - Number(r.appliedValue), 0),
  );
}

/**
 * The batched sibling of getStoreAvailableCredit, for a screen showing several stores at once.
 * Built on the same offsettableReturnWhere conditions so the two can never drift on what
 * "available" means, and it sums REMAINING value — a partially drawn retur deliberately stays
 * offsetStatus AVAILABLE, so reading totalValue here would overstate a store's credit.
 *
 * Every requested id is present in the returned map; a store with nothing offsettable maps to 0,
 * so a caller never has to distinguish "no credit" from "not asked about".
 */
export async function getStoreAvailableCreditMap(storeIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (storeIds.length === 0) return result;
  for (const id of storeIds) result.set(id, 0);

  const rows = await prisma.fieldReturn.findMany({
    where: { ...offsettableReturnWhere(), storeId: { in: storeIds } },
    select: { storeId: true, totalValue: true, appliedValue: true },
  });

  for (const r of rows) {
    const remaining = (r.totalValue ? Number(r.totalValue) : 0) - Number(r.appliedValue);
    result.set(r.storeId, roundCents((result.get(r.storeId) ?? 0) + remaining));
  }
  return result;
}

/**
 * The unpaged, store-scoped twin of `listOffsettableReturns` — built on the identical
 * `offsettableReturnWhere` conditions so the two can never drift on what "available" means, but
 * with no `skip`/`take`. A counter-side picker (the PWA settlement screen) needs every available
 * retur at a store, or a store with more than one page of credit silently loses the rest from the
 * picker, and the `Add retur` button reads its own disabled state off the same truncated count.
 * Never call this without a `storeId` — an unbounded, store-wide fetch here would be the
 * "unpaginated fetch of the whole book" this codebase already treats as a mistake elsewhere.
 */
export async function listAllOffsettableReturns(storeId: string): Promise<OffsettableReturnRow[]> {
  const rows = await prisma.fieldReturn.findMany({
    where: offsettableReturnWhere(storeId),
    orderBy: { approvedAt: "asc" },
    select: {
      id: true,
      docNo: true,
      storeId: true,
      totalValue: true,
      appliedValue: true,
      store: { select: { name: true } },
    },
  });
  return rows.map((r) => {
    const totalValue = r.totalValue ? Number(r.totalValue) : 0;
    const appliedValue = Number(r.appliedValue);
    return {
      id: r.id,
      docNo: r.docNo,
      storeId: r.storeId,
      storeName: r.store.name,
      totalValue,
      appliedValue,
      remainingValue: roundCents(totalValue - appliedValue),
    };
  });
}

/**
 * The screen's own headroom (`remainingValue` above) is only `totalValue - appliedValue` —
 * `submitSettlement` additionally nets every OTHER PENDING settlement's `RETUR_OFFSET` claim on
 * the same retur before refusing with `RETUR_OVERCLAIMED`. Without this, the settlement screen
 * can show and default from headroom the writer will not honor the moment a colleague already
 * holds a pending claim on the same retur. Every requested id is present in the returned map,
 * defaulting to 0, matching `getStoreAvailableCreditMap`'s convention above.
 */
export async function getPendingReturClaimsMap(returnIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (returnIds.length === 0) return result;
  for (const id of returnIds) result.set(id, 0);

  const rows = await prisma.storeSettlementDeduction.groupBy({
    by: ["fieldReturnId"],
    where: {
      type: "RETUR_OFFSET",
      fieldReturnId: { in: returnIds },
      settlement: { status: "PENDING" },
    },
    _sum: { amount: true },
  });

  for (const r of rows) {
    if (!r.fieldReturnId) continue;
    result.set(r.fieldReturnId, roundCents(Number(r._sum.amount ?? 0)));
  }
  return result;
}

export type OffsetAllocationSuggestion = { receivableId: string; amount: number };

/**
 * A SUGGESTED pre-fill only, never a constraint — the offset sheet lets the operator edit
 * freely. Resolves the distinct receivables reachable from the retur's priced lines
 * (priceDeliveryLineId -> FieldSalesDeliveryLine -> its delivery -> that delivery's
 * Receivable), keeps only the ones still OUTSTANDING/PARTIAL, sorts oldest-due-first, and walks
 * them assigning min(remaining, receivable.outstandingAmount) until totalValue is exhausted. If
 * the priced-from set runs out before totalValue does, the remainder is left UNASSIGNED rather
 * than spilling onto unrelated receivables — the operator completes it from the full candidate
 * list in the sheet.
 *
 * `priceDeliveryLineId` carries no foreign key (relationMode = "prisma"), so its delivery line
 * can be gone by the time this runs — that degrades to no suggestion for that line, never a
 * thrown lookup error, mirroring how the field-return detail query already treats the same
 * dangling reference.
 */
export async function suggestOffsetAllocations(returnId: string): Promise<OffsetAllocationSuggestion[]> {
  const ret = await prisma.fieldReturn.findUnique({
    where: { id: returnId },
    select: { totalValue: true, appliedValue: true, lines: { select: { priceDeliveryLineId: true } } },
  });
  if (!ret || ret.totalValue === null) return [];

  const deliveryLineIds = Array.from(
    new Set(ret.lines.map((l) => l.priceDeliveryLineId).filter((x): x is string => x !== null)),
  );
  if (deliveryLineIds.length === 0) return [];

  const deliveryLines = await prisma.fieldSalesDeliveryLine.findMany({
    where: { id: { in: deliveryLineIds } },
    select: { deliveryId: true },
  });
  const deliveryIds = Array.from(new Set(deliveryLines.map((dl) => dl.deliveryId)));
  if (deliveryIds.length === 0) return [];

  const receivables = await prisma.receivable.findMany({
    where: { deliveryId: { in: deliveryIds }, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    select: { id: true, dueDate: true, outstandingAmount: true },
    orderBy: { dueDate: "asc" },
  });

  let remaining = roundCents(Number(ret.totalValue) - Number(ret.appliedValue));
  const suggestions: OffsetAllocationSuggestion[] = [];
  for (const r of receivables) {
    if (remaining <= 0) break;
    const take = roundCents(Math.min(remaining, Number(r.outstandingAmount)));
    if (take <= 0) continue;
    suggestions.push({ receivableId: r.id, amount: take });
    remaining = roundCents(remaining - take);
  }
  return suggestions;
}
