import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * `ORIGINAL_SALE_NOT_JOURNALED`: the leg of the original sale this return leg
 * would reverse is not on this ledger, so there is nothing here to reverse. A
 * return journal is a counter-entry by construction — the revenue leg debits
 * SALES_REVENUE and credits AR, the COGS leg debits INVENTORY and credits COGS —
 * and posting one against a sale this GL never recognized does not undo
 * anything: it drives revenue negative and credits AR against a receivable that
 * was never booked here.
 *
 * The realistic cause is the GL cutover floor (`sweep.ts`): pre-cutover periods
 * are booked in a different system entirely, their sales are deliberately kept
 * out of this ledger, and a return accepted after go-live against one of those
 * sales is the exact hazard the floor exists to prevent — arriving through a
 * door the floor does not cover. The gate is on the counterpart journal rather
 * than on the cutover date on purpose: it needs no second reading of a setting
 * that can be changed, it self-corrects the moment the sale is journaled, and it
 * stays correct for reasons unrelated to the cutover. A sale whose own post
 * failed on an unmapped role, or one whose COGS was zero so no
 * `SALESORDER_COGS` journal exists at all, is equally unreversible — a date
 * check would wave both through.
 *
 * NOT `NOTHING_TO_POST`, which already means the computed value is zero: a
 * genuine no-op that needs no action. This means there IS something to post and
 * it must not be posted here, which the operator may have to act on.
 *
 * Not always permanent, and the operator-facing copy says so. The sales journal
 * sweep runs every 5 minutes, so a return decided in the window before the sweep
 * reaches its own sale is refused now and postable minutes later — the return
 * detail page's "Post journal" button stays offered for exactly that retry,
 * because it is gated on the return's journals being absent rather than on this
 * code.
 */
export type PostSalesReturnJournalResult =
  | GenerateAutoJournalResult
  | { ok: false; code: "ORIGINAL_SALE_NOT_JOURNALED" };

async function returnMeta(
  returnId: string,
  client: AnyClient,
): Promise<{ date: Date; label: string; salesOrderId: string | null } | null> {
  const ret = await client.salesReturn.findUnique({
    where: { id: returnId },
    select: { decidedAt: true, jubelioReturnNo: true, salesOrderId: true },
  });
  if (!ret) return null;
  return {
    date: ret.decidedAt ?? new Date(),
    label: ret.jubelioReturnNo ?? returnId,
    salesOrderId: ret.salesOrderId,
  };
}

/**
 * Whether this ledger recognized the named leg of the original sale, which is
 * the only thing a return leg is allowed to reverse. Each leg asks about its OWN
 * counterpart — the revenue reversal about `SALESORDER_REVENUE`, the COGS
 * reversal about `SALESORDER_COGS` — so a sale that posted only one of its two
 * legs reverses only that one, and the return mirrors exactly what is on the
 * books instead of half-reversing a pair that was never whole.
 *
 * A return with no `salesOrderId` is refused rather than exempted: it cannot be
 * shown to reverse a recognized sale, and "cannot be shown" has to fail closed
 * for the same reason the cutover floor does — an entry wrongly withheld is a
 * visible, recoverable gap, while one wrongly posted into an already-reported
 * period cannot be undone. Note the ingest sets the link on CREATE only, so a
 * return that landed before its own sales order keeps a null link permanently;
 * that is a gap to backfill (`SalesReturn.jubelioReturnId` IS the Jubelio
 * `salesorder_id`), not a reason to loosen this.
 */
async function saleLegIsOnTheBooks(
  salesOrderId: string | null,
  sourceType: "SALESORDER_REVENUE" | "SALESORDER_COGS",
  client: AnyClient,
): Promise<boolean> {
  if (salesOrderId == null) return false;
  const journal = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId: salesOrderId } },
    select: { id: true },
  });
  return journal != null;
}

export async function postSalesReturnRevenueJournal(
  returnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSalesReturnJournalResult> {
  const meta = await returnMeta(returnId, client);
  if (!meta) return { ok: false, code: "NOTHING_TO_POST" };
  const agg = await client.salesReturnItem.aggregate({
    where: { salesReturnId: returnId, decision: "ACCEPTED" },
    _sum: { subtotal: true },
  });
  const value = agg._sum.subtotal == null ? 0 : Number(agg._sum.subtotal);
  /*
   * Value guard BEFORE the counterpart gate, deliberately. A return worth
   * nothing is a genuine no-op whatever the ledger holds, and reporting the
   * louder gate code for it would send the operator chasing a sale journal whose
   * arrival would change nothing.
   */
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  if (!(await saleLegIsOnTheBooks(meta.salesOrderId, "SALESORDER_REVENUE", client))) {
    return { ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" };
  }
  const lines = [
    { role: "SALES_REVENUE" as const, debit: value, credit: 0 },
    { role: "AR" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "SALESRETURN_REVENUE", returnId, lines, {
    date: meta.date,
    description: `Return ${meta.label}`,
    postedById,
  });
}

export async function postSalesReturnCogsJournal(
  returnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSalesReturnJournalResult> {
  const meta = await returnMeta(returnId, client);
  if (!meta) return { ok: false, code: "NOTHING_TO_POST" };
  const items = await client.salesReturnItem.findMany({
    where: { salesReturnId: returnId, decision: "ACCEPTED", stockAdjustmentId: { not: null } },
    select: { stockAdjustment: { select: { qtyChange: true, newAvgCost: true } } },
  });
  const value = items.reduce(
    (sum, it) => sum + (it.stockAdjustment ? Number(it.stockAdjustment.qtyChange) * Number(it.stockAdjustment.newAvgCost) : 0),
    0,
  );
  /* Value guard before the gate — same reasoning as the revenue leg. */
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  if (!(await saleLegIsOnTheBooks(meta.salesOrderId, "SALESORDER_COGS", client))) {
    return { ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED" };
  }
  const lines = [
    { role: "INVENTORY" as const, debit: value, credit: 0 },
    { role: "COGS" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "SALESRETURN_COGS", returnId, lines, {
    date: meta.date,
    description: `Return COGS ${meta.label}`,
    postedById,
  });
}
