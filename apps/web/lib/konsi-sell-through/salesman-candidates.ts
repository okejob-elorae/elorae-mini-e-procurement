import { prisma, type Prisma, type PrismaClient } from "@elorae/db";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * Who may own a sell-through receivable: a user on a non-system role that can file the store
 * settlement for it (`settlements:submit`) from the PWA (`pwa:access`) — the same shape as
 * `listCarrierCandidates`. The dialog's list and the approve writer's check both read this one
 * predicate so they cannot disagree.
 */
export const SALESMAN_CANDIDATE_WHERE: Prisma.UserWhereInput = {
  roleDefinition: {
    isSystem: false,
    AND: [
      { permissions: { some: { permission: { code: "settlements:submit" } } } },
      { permissions: { some: { permission: { code: "pwa:access" } } } },
    ],
  },
};

export async function listSellThroughSalesmanCandidates(): Promise<Array<{ id: string; name: string }>> {
  const users = await prisma.user.findMany({
    where: SALESMAN_CANDIDATE_WHERE,
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

export async function isSellThroughSalesmanCandidate(client: AnyClient, userId: string): Promise<boolean> {
  const n = await client.user.count({ where: { AND: [{ id: userId }, SALESMAN_CANDIDATE_WHERE] } });
  return n > 0;
}

/* The prefill: the salesman on the store's most recent konsi order, only while still a candidate. */
export async function defaultSellThroughSalesmanId(storeId: string): Promise<string | null> {
  const order = await prisma.fieldSalesOrder.findFirst({
    where: { storeId, orderType: "KONSI" },
    orderBy: { createdAt: "desc" },
    select: { salesmanId: true },
  });
  if (!order) return null;
  return (await isSellThroughSalesmanCandidate(prisma, order.salesmanId)) ? order.salesmanId : null;
}
