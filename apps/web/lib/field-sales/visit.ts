import type { Prisma } from "@elorae/db";

type VisitClient = Pick<Prisma.TransactionClient, "storeVisit">;

/**
 * Resolves the visit an order is raised against: the named visit when it
 * belongs to this salesman and store, otherwise the salesman's open visit at
 * the store. Returns null when neither exists. Shared by the order writer and
 * the smart-request build step so both refuse the same way.
 */
export async function findOrderVisit(
  client: VisitClient,
  input: { storeId: string; salesmanId: string; visitId?: string },
): Promise<{ id: string } | null> {
  if (input.visitId) {
    return client.storeVisit.findFirst({
      where: { id: input.visitId, storeId: input.storeId, userId: input.salesmanId },
      select: { id: true },
    });
  }
  return client.storeVisit.findFirst({
    where: { storeId: input.storeId, userId: input.salesmanId, checkoutAt: null },
    select: { id: true },
  });
}
