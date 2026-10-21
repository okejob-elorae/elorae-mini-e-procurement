import { type Prisma } from "@elorae/db";
import { deliveredGoodsValue, undeliveredResidual } from "@/lib/field-sales/delivery/undelivered-residual";

export type CreditExposure = {
  receivableOutstanding: number;
  undeliveredOrderResidual: number;
  total: number;
};

/**
 * A store's live credit exposure: outstanding receivables plus each of its APPROVED putus
 * orders' undelivered residual, floored at zero PER ORDER (never on the grand sum — an
 * over-delivered order must not lend negative headroom to a sibling order's shortfall). The
 * residual subtracts each delivery's exact goods value (`deliveredGoodsValue`), never its
 * whole-rupiah `total`: the rounding is already inside the receivable side, and subtracting the
 * rounded figure would leave a fully delivered order holding its rounding as phantom exposure.
 *
 * Receivable is created at delivery, not at approve, so an approved-but-undelivered order is
 * committed exposure invisible to the receivable ledger without the residual term — see
 * docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md § 2.
 *
 * Takes a transaction client so the gating callers run this inside their own serializable
 * transaction against a consistent snapshot, rather than racing the writes they are gating
 * through the un-transacted `prisma` singleton: `createFieldSalesOrder`'s advisory create-time
 * flag, and `enforceApproveCreditLimit` (`lib/field-sales/writer.ts`), called by the putus
 * approve tail and by `approveKonsiOrderInTx`, the konsi approve core both
 * `approveFieldSalesOrder` and the admin push (`createKonsiPushOrder`) go through. The display
 * previews pass the plain `prisma` client instead and gate nothing: the field-sales order detail
 * page, the konsi push page and the store detail page.
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
    where: { storeId, status: "APPROVED", orderType: "PUTUS", deliveryStatus: { not: "CLOSED" } },
    select: {
      total: true,
      deliveries: { select: { subtotal: true, discountAmount: true, lines: { select: { discountAmount: true } } } },
    },
  });
  let undeliveredOrderResidual = 0;
  for (const order of approvedOrders) {
    undeliveredOrderResidual += undeliveredResidual(
      Number(order.total),
      order.deliveries.map((d) =>
        deliveredGoodsValue({
          subtotal: Number(d.subtotal),
          discountAmount: Number(d.discountAmount),
          lineDiscounts: d.lines.map((l) => Number(l.discountAmount)),
        }),
      ),
    );
  }

  return {
    receivableOutstanding,
    undeliveredOrderResidual,
    total: receivableOutstanding + undeliveredOrderResidual,
  };
}
