import type { prisma, Prisma } from "@elorae/db";

/**
 * The doc numbers, in order, of PENDING store-to-store transfers touching `storeId` (from it or to
 * it) whose goods moved on or before `countMoment` and that move an item::variant the count
 * counted. A count saw such a move but StoreStock has not recorded it yet. Stocktake approval
 * refuses these as `TRANSFER_PENDING`, and sell-through as `TRANSFER_IN_FLIGHT`; each caller throws
 * its own error. Both variantSku columns are non-nullable, so the keys match exactly.
 */
export async function pendingTransfersOverCountedKeys(
  client: Prisma.TransactionClient | typeof prisma,
  storeId: string,
  countMoment: Date,
  countedKeys: Array<{ itemId: string; variantSku: string }>,
): Promise<string[]> {
  if (countedKeys.length === 0) return [];
  const pending = await client.storeTransfer.findMany({
    where: {
      status: "PENDING",
      movedAt: { lte: countMoment },
      OR: [{ fromStoreId: storeId }, { toStoreId: storeId }],
      lines: { some: { OR: countedKeys } },
    },
    orderBy: { docNo: "asc" },
    select: { docNo: true },
  });
  return pending.map((t) => t.docNo);
}
