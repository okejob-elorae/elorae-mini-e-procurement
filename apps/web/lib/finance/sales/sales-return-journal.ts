import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { saleGlDate } from "./sales-journal";
import { readGlCutover } from "./sweep";

type AnyClient = PrismaClient | Prisma.TransactionClient;

type SaleLeg = "SALESORDER_REVENUE" | "SALESORDER_COGS";

/**
 * Why a return leg was refused: the leg of the original sale it would reverse is
 * not on this ledger, so there is nothing here to reverse.
 *
 * A return journal is a counter-entry by construction — the revenue leg debits
 * SALES_REVENUE and credits AR, the COGS leg debits INVENTORY and credits COGS —
 * and posting one against a sale this GL never recognized undoes nothing: it
 * drives revenue negative and credits AR against a receivable that was never
 * booked here. Refusing is correct in every case below. These are four codes
 * rather than one because the REMEDY differs: a single code had to tell every
 * operator to retry after the sweep, which for three of the four is advice that
 * can never come true, and `AdminNotification` has no reader to correct it.
 *
 * The gate itself still asks about the counterpart JOURNAL, never about the
 * cutover date: it needs no reading of a setting that can be changed, it
 * self-corrects the moment the sale is journaled, and it stays correct for
 * reasons unrelated to the cutover (a sale whose own post failed on an unmapped
 * role is equally unreversible). The cutover is read only to REPORT which of
 * these a refusal is.
 *
 * - `ORIGINAL_SALE_NOT_JOURNALED_YET` — the only TRANSIENT one. The sale is on
 *   this ledger's side of the floor and has value to post on this leg, so the
 *   5-minute sales sweep will post it and the same retry then succeeds.
 * - `ORIGINAL_SALE_UNLINKED` — PERMANENT with respect to the sweep, but not a
 *   dead end. The return carries no `salesOrderId`, so nothing can be looked up.
 *   The same code covers a link pointing at an order row that is not there,
 *   which the live DB currently makes unreachable — it still carries a real
 *   `SalesReturn_salesOrderId_fkey` despite the schema's `relationMode =
 *   "prisma"` — so that branch is defensive, not a state to expect. A null link
 *   is common, though: the return often arrives before its sales order, so the
 *   first ingest had nothing to resolve — and two things in apps/api heal it, the
 *   ingest upsert re-linking on UPDATE once the lookup finds an order and the
 *   returns sweeper deliberately re-ingesting a row whose `salesOrderId` is
 *   still null. Outside that window the remedy is a one-shot relink, derivable
 *   because `SalesReturn.jubelioReturnId` IS the Jubelio `salesorder_id`.
 *   Waiting for the sales sweep achieves nothing; restoring the link does.
 * - `ORIGINAL_SALE_OUTSIDE_LEDGER` — PERMANENT, by design, no remedy. Either the
 *   sale falls before the GL cutover floor, so its period is booked in a
 *   different system entirely and a return accepted after go-live against it is
 *   the exact hazard the floor exists to prevent; or that leg of the sale had
 *   nothing to post in the first place (a sale carrying no cost has no
 *   `SALESORDER_COGS` journal and never will). One code because both share the
 *   same truth and the same empty remedy: this leg is not on the books and will
 *   not be.
 * - `GL_CUTOVER_NOT_CONFIGURED` — PERMANENT until Finance sets the cutover date.
 *   With no floor the sweep is inert (`skipped: "NO_CUTOVER"`), so NO sale is
 *   being journaled at all. Reported separately because calling it pre-cutover
 *   would name a cause that isn't true, and calling it unswept would promise a
 *   post that is not coming.
 *
 * None of these is `NOTHING_TO_POST`, which means the computed value is zero: a
 * genuine no-op needing no action. These mean there IS something to post and it
 * must not be posted here.
 */
export type SalesReturnGateCode =
  | "ORIGINAL_SALE_NOT_JOURNALED_YET"
  | "ORIGINAL_SALE_UNLINKED"
  | "ORIGINAL_SALE_OUTSIDE_LEDGER"
  | "GL_CUTOVER_NOT_CONFIGURED";

export type PostSalesReturnJournalResult =
  | GenerateAutoJournalResult
  | { ok: false; code: SalesReturnGateCode };

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
 * `null` when this ledger recognized the named leg of the original sale — the
 * only thing a return leg is allowed to reverse — otherwise the code naming why
 * it did not and whether that can change.
 *
 * Each leg asks about its OWN counterpart, the revenue reversal about
 * `SALESORDER_REVENUE` and the COGS reversal about `SALESORDER_COGS`, so a sale
 * that posted only one of its two legs reverses only that one and the return
 * mirrors exactly what is on the books instead of half-reversing a pair that was
 * never whole.
 *
 * A refusal reads up to three more rows to classify itself; the accepting path
 * stays at the single journal lookup it has always been.
 *
 * Order matters. The missing link is checked first because it is a defect of the
 * return in front of the operator and is answerable without reading any setting.
 * Eligibility is then measured by exactly what the sweep measures —
 * `saleGlDate`, mirroring its `COALESCE(shippedAt, transactionDate)` — so this
 * cannot call a sale unswept that the sweep would never admit.
 */
async function classifySaleLeg(
  salesOrderId: string | null,
  sourceType: SaleLeg,
  client: AnyClient,
): Promise<SalesReturnGateCode | null> {
  if (salesOrderId == null) return "ORIGINAL_SALE_UNLINKED";
  const journal = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId: salesOrderId } },
    select: { id: true },
  });
  if (journal != null) return null;

  const order = await client.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { grandTotal: true, shippedAt: true, transactionDate: true },
  });
  if (order == null) return "ORIGINAL_SALE_UNLINKED";

  const cutover = await readGlCutover();
  if (cutover == null) return "GL_CUTOVER_NOT_CONFIGURED";
  if (saleGlDate(order) < cutover) return "ORIGINAL_SALE_OUTSIDE_LEDGER";

  /*
   * Mirrors the value each sale writer computes (`postSalesRevenueJournal` on
   * `grandTotal`, `postSalesCogsJournal` on Σ item cogs) and its 0.01 floor: a
   * leg the sale itself would report `NOTHING_TO_POST` for has no journal to
   * wait for, so calling it unswept would send the operator back forever.
   */
  const legValue =
    sourceType === "SALESORDER_REVENUE"
      ? Number(order.grandTotal)
      : await sumOrderCogs(salesOrderId, client);
  if (Math.abs(legValue) < 0.01) return "ORIGINAL_SALE_OUTSIDE_LEDGER";

  return "ORIGINAL_SALE_NOT_JOURNALED_YET";
}

async function sumOrderCogs(salesOrderId: string, client: AnyClient): Promise<number> {
  const agg = await client.salesOrderItem.aggregate({
    where: { salesOrderId },
    _sum: { cogs: true },
  });
  return agg._sum.cogs == null ? 0 : Number(agg._sum.cogs);
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
  const gate = await classifySaleLeg(meta.salesOrderId, "SALESORDER_REVENUE", client);
  if (gate != null) return { ok: false, code: gate };
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
  const gate = await classifySaleLeg(meta.salesOrderId, "SALESORDER_COGS", client);
  if (gate != null) return { ok: false, code: gate };
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
