import { prisma, type Prisma } from "@elorae/db";
import { salesorderNoForSettlement } from "./match-key";
import { escrowAmountOrNull, isEscrowMissing } from "./queries";

/**
 * The Jubelio order numbers a settlement still needs fetched: every line the matcher could not
 * place, plus every matched line whose stored order carries no escrow data — that copy may predate
 * Jubelio publishing escrow, and a fetch is the only way to refresh it.
 *
 * `SettlementLine.matchedSalesOrderId` carries no Prisma relation field (a plain column, not an
 * FK `@relation`) — the matched orders are read back with a second `findMany` keyed on that id
 * instead of a nested `select`.
 */
export async function collectResyncTargets(
  settlementId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string[]> {
  const settlement = await client.settlement.findUnique({
    where: { id: settlementId },
    select: { marketplace: true },
  });
  if (!settlement) return [];

  const lines = await client.settlementLine.findMany({
    where: { settlementId },
    select: {
      orderNo: true,
      netIncome: true,
      matchStatus: true,
      matchedSalesOrderId: true,
    },
  });

  const matchedSalesOrderIds = Array.from(
    new Set(lines.map((l) => l.matchedSalesOrderId).filter((v): v is string => v !== null)),
  );
  const matchedOrders = matchedSalesOrderIds.length
    ? await client.salesOrder.findMany({
        where: { id: { in: matchedSalesOrderIds } },
        select: { id: true, status: true, feeBreakdown: true },
      })
    : [];
  const orderById = new Map(matchedOrders.map((o) => [o.id, o]));

  const targets = new Set<string>();
  for (const l of lines) {
    const matched = l.matchStatus === "MATCHED";
    const order = l.matchedSalesOrderId ? orderById.get(l.matchedSalesOrderId) : undefined;
    const canceled = order?.status === "CANCELLED";
    const jubelioNet = order
      ? escrowAmountOrNull(order.feeBreakdown as Record<string, string> | null, canceled)
      : null;
    const needsFetch =
      !matched || isEscrowMissing({ matched, canceled, netIncome: Number(l.netIncome), jubelioNet });
    if (!needsFetch) continue;
    const key = salesorderNoForSettlement(settlement.marketplace, l.orderNo);
    if (key) targets.add(key);
  }
  return [...targets];
}
