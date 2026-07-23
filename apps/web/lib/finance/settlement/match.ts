import { prisma, Prisma } from "@elorae/db";
import { salesorderNoForSettlement } from "./match-key";

export type MatchResult = { matched: number; unmatched: number; profitPending: number };

export async function matchSettlement(
  settlementId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<MatchResult> {
  const settlement = await client.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { marketplace: true },
  });
  const lines = await client.settlementLine.findMany({
    where: { settlementId },
    select: { id: true, orderNo: true, netIncome: true },
  });

  // Resolve candidate salesorderNos, then bulk-load matching orders + their item cogs.
  const keyByLineId = new Map<string, string>();
  const keys: string[] = [];
  for (const l of lines) {
    const k = salesorderNoForSettlement(settlement.marketplace, l.orderNo);
    if (k) {
      keyByLineId.set(l.id, k);
      keys.push(k);
    }
  }
  const orders = keys.length
    ? await client.salesOrder.findMany({
        where: { salesorderNo: { in: keys } },
        select: { id: true, salesorderNo: true, items: { select: { cogs: true } } },
      })
    : [];
  const orderByNo = new Map(orders.map((o) => [o.salesorderNo, o]));

  let matched = 0;
  let unmatched = 0;
  let profitPending = 0;

  for (const l of lines) {
    const key = keyByLineId.get(l.id);
    const order = key ? orderByNo.get(key) : undefined;

    if (!order) {
      unmatched += 1;
      await client.settlementLine.update({
        where: { id: l.id },
        data: { matchStatus: "UNMATCHED", matchedSalesOrderId: null, cogsSnapshot: null, profit: null },
      });
      continue;
    }

    matched += 1;
    // cogs null on ANY line (or no lines) → cost pending, can't compute a trustworthy total.
    const anyNull = order.items.some((it) => it.cogs === null);
    if (anyNull || order.items.length === 0) {
      profitPending += 1;
      await client.settlementLine.update({
        where: { id: l.id },
        data: { matchStatus: "MATCHED", matchedSalesOrderId: order.id, cogsSnapshot: null, profit: null },
      });
    } else {
      const cogs = order.items.reduce((s, it) => s + Number(it.cogs), 0);
      await client.settlementLine.update({
        where: { id: l.id },
        data: {
          matchStatus: "MATCHED",
          matchedSalesOrderId: order.id,
          cogsSnapshot: cogs,
          profit: Number(l.netIncome) - cogs,
        },
      });
    }
  }

  await client.settlement.update({ where: { id: settlementId }, data: { status: "MATCHED" } });

  return { matched, unmatched, profitPending };
}
