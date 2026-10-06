import { prisma, Prisma } from "@elorae/db";
import { salesorderNoForSettlement } from "./match-key";
import { lockSettlementRow } from "./lock";

export type MatchResult = {
  matched: number;
  unmatched: number;
  profitPending: number;
  /* Set when nothing was written: no line was touched and the status is unchanged. */
  refused?: "RECONCILED";
};

type AnyClient = Prisma.TransactionClient | typeof prisma;

function hasTx(client: AnyClient): client is typeof prisma {
  return typeof (client as typeof prisma).$transaction === "function";
}

/**
 * Which SalesOrder column a settlement's resolved key is looked up against.
 * Shopee reconstructs `SP-<orderNo>` and matches `salesorderNo`; TikTok/Tokopedia
 * match the raw `orderNo` against `channelOrderNo` (populated from Jubelio's
 * `ref_no` — see Sub-C).
 */
function matchColumn(marketplace: string): "salesorderNo" | "channelOrderNo" {
  return marketplace === "SHOPEE" ? "salesorderNo" : "channelOrderNo";
}

/**
 * Rewrites every line's match and profit figures from the `SalesOrder` rows and item `cogs` as
 * they stand now — never on a `RECONCILED` settlement, which is refused with no write at all.
 *
 * The refusal and the line writes share one transaction that holds the settlement row
 * `FOR UPDATE` from its first statement. `postSettlementJournal` takes the same row lock first, so
 * a match and a journal post serialise: a match never rewrites the lines of a settlement whose
 * journal has posted, and a journal never posts mid-match. A caller passing its own transaction
 * client gets the lock in that transaction, held until it commits, and must not have read in it
 * before calling (see `lockSettlementRow`). The lock also blocks every other `Settlement` writer
 * — `startSettlementResync`'s update, the rematch sweep's stamp CAS — for the match's duration;
 * they wait, bounded by the server's lock-wait timeout.
 */
export async function matchSettlement(settlementId: string, client: AnyClient = prisma): Promise<MatchResult> {
  if (hasTx(client)) {
    /* One `UPDATE` per line runs under the lock, so a large settlement needs well past the 5s default. */
    return client.$transaction((tx) => matchSettlementLocked(settlementId, tx), {
      timeout: 120_000,
      maxWait: 10_000,
    });
  }
  return matchSettlementLocked(settlementId, client);
}

async function matchSettlementLocked(settlementId: string, client: Prisma.TransactionClient): Promise<MatchResult> {
  /*
   * The status decision comes from the locking read itself. A missing row falls through to the
   * `findUniqueOrThrow` below, which throws exactly as before.
   */
  const locked = await lockSettlementRow(client, settlementId);
  if (locked?.status === "RECONCILED") {
    return { matched: 0, unmatched: 0, profitPending: 0, refused: "RECONCILED" };
  }

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

  /**
   * Still guarded, never a plain `update`: a RECONCILED settlement has a posted journal, and setting
   * it back to MATCHED would reopen it beside that journal. The lock above already refuses one, so
   * this guard is the backstop, not the rule.
   */
  await client.settlement.updateMany({
    where: { id: settlementId, status: { not: "RECONCILED" } },
    data: { status: "MATCHED" },
  });

  return { matched, unmatched, profitPending };
}
