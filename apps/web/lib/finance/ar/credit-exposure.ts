import { type Prisma } from "@elorae/db";

export type CreditExposure = {
  receivableOutstanding: number;
  undeliveredOrderResidual: number;
  total: number;
};

/**
 * A store's live credit exposure: outstanding receivables plus each of its APPROVED putus
 * orders' undelivered residual, floored at zero PER ORDER (never on the grand sum — an
 * over-delivered order must not lend negative headroom to a sibling order's shortfall).
 *
 * Receivable is created at delivery, not at approve, so an approved-but-undelivered order is
 * committed exposure invisible to the receivable ledger without the residual term — see
 * docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md § 2.
 *
 * Takes a transaction client so both call sites (create, approve) run this inside their own
 * serializable transaction against a consistent snapshot, rather than racing the writes they
 * are gating through the un-transacted `prisma` singleton.
 */
export async function computeStoreCreditExposure(
  client: Prisma.TransactionClient,
  storeId: string,
): Promise<CreditExposure> {
  const receivables = await client.receivable.findMany({
    where: { storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    select: { outstandingAmount: true },
  });
  const receivableOutstanding = receivables.reduce((sum, r) => sum + Number(r.outstandingAmount), 0);

  const approvedOrders = await client.fieldSalesOrder.findMany({
    where: { storeId, status: "APPROVED", orderType: "PUTUS" },
    select: {
      total: true,
      deliveries: { select: { total: true } },
    },
  });
  let undeliveredOrderResidual = 0;
  for (const order of approvedOrders) {
    const delivered = order.deliveries.reduce((sum, d) => sum + Number(d.total), 0);
    const residual = Number(order.total) - delivered;
    undeliveredOrderResidual += Math.max(0, residual);
  }

  return {
    receivableOutstanding,
    undeliveredOrderResidual,
    total: receivableOutstanding + undeliveredOrderResidual,
  };
}
