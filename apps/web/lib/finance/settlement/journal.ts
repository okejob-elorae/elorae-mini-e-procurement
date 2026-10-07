import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { splitMarketplaceFees, type MarketplaceFeeRole } from "./fee-split";
import { lockSettlementRow } from "./lock";
import { classifySaleLegs } from "@/lib/finance/sales/sales-return-journal";
import { isSweepEligibleOrder } from "@/lib/finance/sales/sweep";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export type PostSettlementJournalResult =
  | { ok: true; journalId: string; created: boolean }
  | {
      ok: false;
      code:
        | "CHECKSUM_BLOCKED"
        | "UNMAPPED_ROLE"
        | "UNBALANCED"
        | "ALREADY_RECONCILED_DIFF"
        | "NON_POSTABLE_ACCOUNT"
        | "NOTHING_TO_POST";
      role?: string;
    }
  | { ok: false; code: SettlementGateCode; count: number };

export type SettlementGateCode =
  | "GL_CUTOVER_NOT_CONFIGURED"
  | "ORIGINAL_SALE_OUTSIDE_LEDGER"
  | "LINES_UNMATCHED"
  | "ORIGINAL_SALE_NOT_SHIPPED"
  | "ORIGINAL_SALE_NOT_JOURNALED_YET";

/**
 * Refusals no wait can cure come first, so the operator is never told to wait for a post that
 * cannot come. `ORIGINAL_SALE_NOT_SHIPPED` sits ahead of the 5-minute sweep's code because the
 * order may never ship at all.
 */
const GATE_PRIORITY: SettlementGateCode[] = [
  "GL_CUTOVER_NOT_CONFIGURED",
  "ORIGINAL_SALE_OUTSIDE_LEDGER",
  "LINES_UNMATCHED",
  "ORIGINAL_SALE_NOT_SHIPPED",
  "ORIGINAL_SALE_NOT_JOURNALED_YET",
];

/**
 * Marketplaces whose parser stores every money figure of a line in the line's own columns. The
 * TikTok parser stores only `netIncome` and keeps its fees in `raw` (see its own note), so a
 * TikTok line with zero payout can still carry fees that `totalPendapatan` includes.
 */
const LINE_AMOUNTS_COMPLETE: ReadonlySet<string> = new Set(["SHOPEE"]);

type SettlementLineAmounts = {
  netIncome: Prisma.Decimal;
  hargaAsliProduk: Prisma.Decimal;
  totalDiskonProduk: Prisma.Decimal;
  biayaAdministrasi: Prisma.Decimal;
  biayaLayanan: Prisma.Decimal;
  biayaKomisiAms: Prisma.Decimal;
  biayaProsesPesanan: Prisma.Decimal;
};

/* True only when the line provably adds nothing to the settlement's income or fees. */
function lineAmountsAreZero(line: SettlementLineAmounts, marketplace: string): boolean {
  if (!LINE_AMOUNTS_COMPLETE.has(marketplace)) return false;
  return [
    line.netIncome,
    line.hargaAsliProduk,
    line.totalDiskonProduk,
    line.biayaAdministrasi,
    line.biayaLayanan,
    line.biayaKomisiAms,
    line.biayaProsesPesanan,
  ].every((amount) => Math.abs(Number(amount)) < 0.01);
}

/**
 * `null` when every line of the settlement belongs to a sales order whose
 * `SALESORDER_REVENUE` journal stands, otherwise the refusal and how many LINES
 * it covers.
 *
 * The journal below credits AR with `totalPendapatan`, and the only journals on
 * this ledger that debit AR for a marketplace sale are the sales sweep's
 * `SALESORDER_REVENUE` ones. Crediting AR for a sale that never debited it
 * drives Piutang negative, so the settlement may post only against sales this
 * ledger recognized — the same counterpart gate `classifySaleLeg` applies to
 * marketplace returns.
 *
 * The gate is whole-settlement, not per order: `totalPendapatan` and the fees
 * are summary-level figures with no per-order split, so a partial post could
 * not balance. A line matched to an order that no longer exists counts as
 * unmatched, because rematching is its remedy, and a settlement with no lines
 * at all refuses `LINES_UNMATCHED` (count 0) rather than vouching for a
 * `totalPendapatan` no line stands behind. A settlement straddling the GL
 * cutover (the first one per marketplace after go-live) is permanently
 * `ORIGINAL_SALE_OUTSIDE_LEDGER`; its remedy is a manual journal.
 *
 * Two refinements over `classifySaleLegs`, both because a settlement must never
 * wait on a journal the sweep will never post.
 *
 * A line whose matched order is worth nothing (`grandTotal` under 0.01, the
 * floor the revenue writer itself applies) AND whose own amounts are all zero
 * does not block, on either side of the cutover: no revenue journal will ever
 * exist for it, and it adds nothing to `totalPendapatan`. Both halves are
 * needed. The credit is built from the settlement's own income figures, not
 * from the order, so a voucher-covered order at `grandTotal` 0 whose line the
 * marketplace still paid income on would put that income on AR with nothing
 * debiting it — such a line keeps `classifySaleLegs`' refusal,
 * `ORIGINAL_SALE_OUTSIDE_LEDGER`, whose remedy is a manual journal. The line
 * test only trusts a marketplace whose lines store their whole breakdown
 * (`LINE_AMOUNTS_COMPLETE`); anywhere else a zero-value line refuses too.
 *
 * And an order the sweep will not admit (`isSweepEligibleOrder` false) is
 * `ORIGINAL_SALE_NOT_SHIPPED` rather than `ORIGINAL_SALE_NOT_JOURNALED_YET`: it
 * posts once the order reads shipped and the sweep journals it, and otherwise
 * needs a manual journal. Neither refinement applies while the cutover is
 * unset, since then no sale is journaled at all.
 */
async function settlementGate(
  settlementId: string,
  marketplace: string,
  tx: Prisma.TransactionClient,
): Promise<{ code: SettlementGateCode; count: number } | null> {
  const lines = await tx.settlementLine.findMany({
    where: { settlementId },
    select: {
      matchedSalesOrderId: true,
      netIncome: true,
      hargaAsliProduk: true,
      totalDiskonProduk: true,
      biayaAdministrasi: true,
      biayaLayanan: true,
      biayaKomisiAms: true,
      biayaProsesPesanan: true,
    },
  });
  if (lines.length === 0) return { code: "LINES_UNMATCHED", count: 0 };
  const orderIds = lines.flatMap((l) => (l.matchedSalesOrderId == null ? [] : [l.matchedSalesOrderId]));
  const verdicts = await classifySaleLegs(orderIds, "SALESORDER_REVENUE", tx);

  const refinable = [...verdicts.entries()]
    .filter(([, v]) => v === "ORIGINAL_SALE_OUTSIDE_LEDGER" || v === "ORIGINAL_SALE_NOT_JOURNALED_YET")
    .map(([id]) => id);
  const orders =
    refinable.length === 0
      ? []
      : await tx.salesOrder.findMany({
          where: { id: { in: refinable } },
          select: { id: true, grandTotal: true, status: true, fulfillmentStatus: true },
        });
  const zeroValue = new Set<string>();
  const notShipped = new Set<string>();
  for (const order of orders) {
    if (Math.abs(Number(order.grandTotal)) < 0.01) zeroValue.add(order.id);
    else if (!isSweepEligibleOrder(order)) notShipped.add(order.id);
  }

  const counts = new Map<SettlementGateCode, number>();
  for (const line of lines) {
    const orderId = line.matchedSalesOrderId;
    const verdict = orderId == null ? "ORIGINAL_SALE_UNLINKED" : verdicts.get(orderId);
    if (verdict === null) continue;
    if (orderId != null && zeroValue.has(orderId) && lineAmountsAreZero(line, marketplace)) continue;
    let code: SettlementGateCode;
    if (verdict === undefined || verdict === "ORIGINAL_SALE_UNLINKED") code = "LINES_UNMATCHED";
    else if (verdict === "ORIGINAL_SALE_NOT_JOURNALED_YET" && orderId != null && notShipped.has(orderId)) {
      code = "ORIGINAL_SALE_NOT_SHIPPED";
    } else code = verdict;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  for (const code of GATE_PRIORITY) {
    const count = counts.get(code) ?? 0;
    if (count > 0) return { code, count };
  }
  return null;
}

/**
 * Falls back to the legacy lumped `MARKETPLACE_FEE` account when a per-category
 * role is not mapped yet, so settlements keep posting on an existing chart of
 * accounts instead of failing until an admin wires five new mappings.
 */
async function resolveFeeAccount(role: MarketplaceFeeRole, client: AnyClient): Promise<string> {
  try {
    return await resolveAccount(role, client);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
    try {
      return await resolveAccount("MARKETPLACE_FEE", client);
    } catch (fallbackError) {
      /* Name the category the operator actually hit, not the fallback they never chose. */
      if (fallbackError instanceof UnmappedRoleError) throw new UnmappedRoleError(role);
      throw fallbackError;
    }
  }
}

export async function postSettlementJournal(
  settlementId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSettlementJournalResult> {
  const s = await client.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      id: true,
      checksumOk: true,
      totalDilepas: true,
      totalPengeluaran: true,
      totalPendapatan: true,
      seller: true,
      marketplace: true,
      periodTo: true,
    },
  });

  if (!s.checksumOk) return { ok: false, code: "CHECKSUM_BLOCKED" };

  const feeTotals = await client.settlementLine.aggregate({
    where: { settlementId: s.id },
    _sum: {
      biayaAdministrasi: true,
      biayaLayanan: true,
      biayaKomisiAms: true,
      biayaProsesPesanan: true,
    },
  });

  /**
   * `SettlementLine.biaya*` columns and `Settlement.totalPengeluaran` are
   * stored NEGATIVE in real data — they are deductions, not costs — and
   * `splitMarketplaceFees` needs non-negative magnitudes to emit debit lines
   * (see `fee-split.ts`'s "negative amount becomes a credit" rule). Feeding
   * it the raw signed sums would flip every itemized category into a
   * contra-expense credit, the inverse of the intended breakdown, and can
   * leave the journal unbalanced once bank/AR are added. Normalize with
   * `Math.abs()` here, at read time — not in the Shopee parser, since the
   * stored signed values are also consumed elsewhere (e.g. settlement
   * compare views) and flipping them there would ripple. This mirrors the
   * same convention `tiktok-settlement-parser.ts` already applies to
   * `totalBiaya` for the identical reason (see its top-of-file comment and
   * the per-line `Math.abs()` note near its `totalPengeluaran +=`).
   */
  const feeSplit = splitMarketplaceFees(
    {
      admin: Math.abs(Number(feeTotals._sum.biayaAdministrasi ?? 0)),
      service: Math.abs(Number(feeTotals._sum.biayaLayanan ?? 0)),
      commission: Math.abs(Number(feeTotals._sum.biayaKomisiAms ?? 0)),
      processing: Math.abs(Number(feeTotals._sum.biayaProsesPesanan ?? 0)),
    },
    Math.abs(Number(s.totalPengeluaran)),
  );

  let bank: string, ar: string;
  const feeAccounts = new Map<MarketplaceFeeRole, string>();
  try {
    bank = await resolveAccount("BANK", client);
    ar = await resolveAccount("AR", client);
    for (const split of feeSplit) {
      feeAccounts.set(split.role, await resolveFeeAccount(split.role, client));
    }
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  /*
   * A journal line must carry exactly one of debit/credit greater than zero, so
   * a zero total (a fully refunded period) is omitted, the same way
   * `splitMarketplaceFees` drops a zero fee category.
   */
  const lines = [
    { chartAccountId: bank, debit: Number(s.totalDilepas), credit: 0 },
    ...feeSplit.map((split) => ({
      chartAccountId: feeAccounts.get(split.role)!,
      debit: split.debit,
      credit: split.credit,
      /* Distinguishes categories that share the legacy MARKETPLACE_FEE fallback account. */
      memo: split.role,
    })),
    { chartAccountId: ar, debit: 0, credit: Number(s.totalPendapatan) },
  ].filter((l) => l.debit !== 0 || l.credit !== 0);

  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  /* One surviving line can never balance, and `postJournal` would throw TOO_FEW_LINES. */
  if (lines.length < 2) return { ok: false, code: "UNBALANCED" };

  const run = async (tx: Prisma.TransactionClient) => {
    /**
     * First statement of the transaction: `matchSettlement` holds this same row lock for its whole
     * line rewrite, so a post waits out a running match and a match started after this waits for
     * the commit and then sees RECONCILED. The reads above stay outside it on purpose — totals and
     * fee sums are columns a match never writes. With a caller-supplied transaction client there is
     * no separate transaction: those reads run inside the caller's, before this lock, so such a
     * caller must not depend on that snapshot, since a locking read after an earlier consistent
     * read can raise ER_CHECKREAD under `innodb_snapshot_isolation` on newer MariaDB. No caller
     * passes one today. The revenue-journal gate reads the lines only after this lock, because
     * `matchSettlement` rewrites `matchedSalesOrderId` under it.
     */
    await lockSettlementRow(tx, s.id);
    const gate = await settlementGate(s.id, s.marketplace, tx);
    /* Write-free so far (the lock is a read), so this return commits nothing. */
    if (gate != null) return { ok: false as const, code: gate.code, count: gate.count };
    const res = await postJournal(tx, {
      source: { type: "SETTLEMENT", id: s.id },
      date: s.periodTo,
      description: `Marketplace settlement — ${s.seller}`,
      postedById,
      lines,
    });
    await tx.settlement.update({ where: { id: s.id }, data: { status: "RECONCILED" } });
    return { ok: true as const, journalId: res.journalId, created: res.created };
  };

  try {
    /*
     * Same budget as `matchSettlement`'s transaction, so a post queued behind a long match waits
     * instead of dying at Prisma's 5s default. `innodb_lock_wait_timeout` stays at the server
     * default (50s, no override in this repo), so any waiter still fails with ER 1205 after 50s;
     * the 120s budget protects the lock holder, not the waiter.
     */
    return hasTx(client)
      ? await client.$transaction(run, { timeout: 120_000, maxWait: 10_000 })
      : await run(client as Prisma.TransactionClient);
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") {
      return { ok: false, code: "NON_POSTABLE_ACCOUNT" };
    }
    throw e;
  }
}
