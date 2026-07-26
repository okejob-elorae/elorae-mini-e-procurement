import { prisma, Prisma } from "@elorae/db";
import { salesorderNoForSettlement } from "./match-key";

export type MatchResult = { matched: number; unmatched: number; profitPending: number };

/**
 * Which SalesOrder column a settlement's resolved key is looked up against.
 * Shopee reconstructs `SP-<orderNo>` and matches `salesorderNo`; TikTok/Tokopedia
 * match the raw `orderNo` against `channelOrderNo` (populated from Jubelio's
 * `ref_no` — see Sub-C).
 */
function matchColumn(marketplace: string): "salesorderNo" | "channelOrderNo" {
  return marketplace === "SHOPEE" ? "salesorderNo" : "channelOrderNo";
}

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

  const column = matchColumn(settlement.marketplace);

  // Resolve candidate keys, then bulk-load matching orders + their item cogs.
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
        where: column === "salesorderNo" ? { salesorderNo: { in: keys } } : { channelOrderNo: { in: keys } },
        select: {
          id: true,
          salesorderNo: true,
          channelOrderNo: true,
          items: { select: { cogs: true } },
        },
      })
    : [];
  // Neither salesorderNo nor channelOrderNo is guaranteed unique across rows
  // (returns, re-ingests) — group so a duplicate never silently picks the
  // wrong row via last-wins.
  type OrderRow = (typeof orders)[number];
  const ordersByNo = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const key = column === "salesorderNo" ? o.salesorderNo : o.channelOrderNo;
    if (!key) continue;
    const bucket = ordersByNo.get(key);
    if (bucket) bucket.push(o);
    else ordersByNo.set(key, [o]);
  }

  let matched = 0;
  let unmatched = 0;
  let profitPending = 0;

  for (const l of lines) {
    const key = keyByLineId.get(l.id);
    const matches = key ? ordersByNo.get(key) ?? [] : [];

    if (matches.length === 0) {
      unmatched += 1;
      await client.settlementLine.update({
        where: { id: l.id },
        data: { matchStatus: "UNMATCHED", matchedSalesOrderId: null, cogsSnapshot: null, profit: null },
      });
      continue;
    }

    if (matches.length > 1) {
      // Ambiguous: multiple SalesOrders share this salesorderNo. Record the match so
      // it's visible, but never guess which row's cogs applies — surface as needs-review.
      matched += 1;
      profitPending += 1;
      await client.settlementLine.update({
        where: { id: l.id },
        data: {
          matchStatus: "MATCHED",
          matchedSalesOrderId: matches[0].id,
          cogsSnapshot: null,
          profit: null,
        },
      });
      continue;
    }

    const order = matches[0];
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
