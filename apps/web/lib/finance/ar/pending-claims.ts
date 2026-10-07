import type { Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";

/**
 * Every PENDING claim standing against one receivable, both kinds: collectors' PENDING
 * `CollectionSubmission`s and PENDING settlements' `StoreSettlementInvoice` rows. Must be called
 * with the TRANSACTION client of the writer about to add a claim, inside its `runSerializable` —
 * the same reasoning as each writer's former single-kind aggregate. The settlement half is scoped
 * to `storeId` so it uses `@@index([storeId, status])` instead of S-locking every store's PENDING
 * range (see `submitSettlement`'s comment).
 */
export async function sumPendingClaimsOnReceivable(
  tx: Prisma.TransactionClient,
  input: { receivableId: string; storeId: string },
): Promise<{ collections: number; settlements: number; total: number }> {
  const submitted = await tx.collectionSubmission.aggregate({
    where: { receivableId: input.receivableId, status: "PENDING" },
    _sum: { amount: true },
  });
  const claimed = await tx.storeSettlementInvoice.aggregate({
    where: { receivableId: input.receivableId, settlement: { status: "PENDING", storeId: input.storeId } },
    _sum: { amount: true },
  });
  const collections = roundCents(Number(submitted._sum.amount ?? 0));
  const settlements = roundCents(Number(claimed._sum.amount ?? 0));
  return { collections, settlements, total: roundCents(collections + settlements) };
}
