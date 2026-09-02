import { prisma, Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";

export type OffsettableReturnRow = {
  id: string;
  docNo: string;
  storeId: string;
  storeName: string;
  totalValue: number;
};

const OFFSETTABLE_PAGE_SIZE = 25;

/**
 * Approved, fully-valued, not-yet-applied returns — the exact three conditions
 * `applyReturnOffset` itself enforces. Never widen this beyond `storeId` + `page`: a retur
 * cannot be hard-linked to one receivable (its lines price independently), so the store is the
 * only key that holds for every retur.
 */
export async function listOffsettableReturns(
  params: { storeId?: string; page?: number } = {},
): Promise<{ rows: OffsettableReturnRow[]; total: number }> {
  const page = params.page ?? 1;
  const where: Prisma.FieldReturnWhereInput = {
    status: "APPROVED",
    valuationStatus: "VALUED",
    offsetStatus: "AVAILABLE",
    ...(params.storeId ? { storeId: params.storeId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.fieldReturn.findMany({
      where,
      orderBy: { approvedAt: "asc" },
      skip: (page - 1) * OFFSETTABLE_PAGE_SIZE,
      take: OFFSETTABLE_PAGE_SIZE,
      select: { id: true, docNo: true, storeId: true, totalValue: true, store: { select: { name: true } } },
    }),
    prisma.fieldReturn.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      storeId: r.storeId,
      storeName: r.store.name,
      totalValue: r.totalValue ? Number(r.totalValue) : 0,
    })),
    total,
  };
}

/**
 * Pure aggregate — no new table, no stored figure. A retur counts here for as long as it sits
 * AVAILABLE; the moment it is offset it stops contributing, with no separate "consumed" ledger
 * to keep in sync.
 */
export async function getStoreAvailableCredit(storeId: string): Promise<number> {
  const rows = await prisma.fieldReturn.findMany({
    where: { storeId, status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE" },
    select: { totalValue: true },
  });
  return roundCents(rows.reduce((sum, r) => sum + (r.totalValue ? Number(r.totalValue) : 0), 0));
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
    select: { totalValue: true, lines: { select: { priceDeliveryLineId: true } } },
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

  let remaining = roundCents(Number(ret.totalValue));
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
