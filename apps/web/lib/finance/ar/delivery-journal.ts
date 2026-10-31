import type { Prisma } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { runSerializable } from "@/lib/db/tx-retry";
import { KANAL_JURNAL } from "@/lib/finance/journals/kanal";
import { SEMUA_SUMBER_JURNAL_NOTA, SUMBER_LAPANGAN, SUMBER_NOTA_LAMA } from "@/lib/finance/lapangan/aturan";
import { postingNotaKait } from "@/lib/finance/lapangan/kait";

/**
 * A putus delivery has ONE journal: the nota journal (`FIELD_DELIVERY`, `lib/finance/lapangan`),
 * which books the store receivable (AR_STORE), the revenue net of PPN, the PPN and the COGS in one
 * entry. The two functions below keep their names because the shipment actions and the
 * receivable's retry control call them through `postArJournalSafely` under the
 * `field_delivery_revenue`/`field_delivery_cogs` kinds, but neither ever starts the old two-journal
 * pair (`FIELD_DELIVERY_REVENUE` + `FIELD_DELIVERY_COGS`) for a delivery that has no journal.
 *
 * What they do, decided per delivery under its row lock:
 * - it already has the nota journal, or the half of the old pair asked for → that journal, unchanged;
 * - it holds the OTHER half of the old pair only → the missing half under the old pair's source
 *   type, so the pair completes (its receivable on AR_STORE, see `postLegacyRevenue`). The nota
 *   journal would book the posted half a second time, and the nota engine refuses any delivery
 *   holding an old journal, so this is the only way that half ever posts;
 * - it has no journal at all → the nota journal, through the nota hook (`postingNotaKait`).
 *
 * Old-pair halves are dated on the delivery's `invoiceDate`, which is also the date its receivable
 * ages from, never on when the post ran. Each one reads the delivery and writes its journal in one
 * transaction whose first statement locks the delivery row, so a post and a date correction
 * serialise; `updateDeliveryDatesAction` re-dates every delivery journal type on the same row.
 */

type DeliveryJournalState = { nota: string | null; revenue: string | null; cogs: string | null };

async function lockDelivery(tx: Prisma.TransactionClient, deliveryId: string): Promise<boolean> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT \`id\` FROM \`FieldSalesDelivery\` WHERE \`id\` = ${deliveryId} FOR UPDATE
  `;
  return locked.length > 0;
}

async function journalState(tx: Prisma.TransactionClient, deliveryId: string): Promise<DeliveryJournalState> {
  const journals = await tx.journal.findMany({
    where: { sourceId: deliveryId, sourceType: { in: [...SEMUA_SUMBER_JURNAL_NOTA] } },
    select: { id: true, sourceType: true },
  });
  const idOf = (sourceType: string) => journals.find((j) => j.sourceType === sourceType)?.id ?? null;
  return {
    nota: idOf(SUMBER_LAPANGAN.NOTA),
    revenue: idOf(SUMBER_NOTA_LAMA.PENDAPATAN),
    cogs: idOf(SUMBER_NOTA_LAMA.HPP),
  };
}

const standing = (journalId: string): GenerateAutoJournalResult => ({ ok: true, journalId, created: false });

/**
 * The old pair's revenue half on the delivery total: DR the store receivable / CR SALES_REVENUE.
 * The receivable is AR_STORE, the one store-receivables role every store invoice debits today,
 * tagged with its role as memo and with the store, so `postPaymentReceiptJournal` credits AR_STORE
 * back and the store-receivables reconciliation reads it per store. Only the revenue halves posted
 * before this rule carry AR; those stand as they are.
 */
async function postLegacyRevenue(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  postedById: string,
): Promise<GenerateAutoJournalResult> {
  const delivery = await tx.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: { docNo: true, total: true, invoiceDate: true, order: { select: { storeId: true } } },
  });
  if (!delivery) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(delivery.total);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const storeId = delivery.order.storeId;
  return generateAutoJournal(
    tx,
    SUMBER_NOTA_LAMA.PENDAPATAN,
    deliveryId,
    [
      { role: "AR_STORE", debit: value, credit: 0, memo: "AR_STORE", storeId },
      { role: "SALES_REVENUE", debit: 0, credit: value, memo: "SALES_REVENUE", channel: KANAL_JURNAL.PUTUS, storeId },
    ],
    { date: delivery.invoiceDate, description: `Nota tagihan ${delivery.docNo}`, postedById },
  );
}

/**
 * The old pair's COGS half. `cogsAmount` is null for every delivery recorded before it existed,
 * and that resolves to NOTHING_TO_POST rather than a zero-value journal.
 */
async function postLegacyCogs(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  postedById: string,
): Promise<GenerateAutoJournalResult> {
  const delivery = await tx.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: { docNo: true, cogsAmount: true, invoiceDate: true, order: { select: { storeId: true } } },
  });
  if (!delivery || delivery.cogsAmount === null) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(delivery.cogsAmount);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    tx,
    SUMBER_NOTA_LAMA.HPP,
    deliveryId,
    [
      { role: "COGS", debit: value, credit: 0, memo: "COGS", channel: KANAL_JURNAL.PUTUS, storeId: delivery.order.storeId },
      { role: "INVENTORY", debit: 0, credit: value, memo: "INVENTORY" },
    ],
    { date: delivery.invoiceDate, description: `HPP nota tagihan ${delivery.docNo}`, postedById },
  );
}

/**
 * The nota journal for a delivery with none, through the same hook the delivery action uses
 * (`postingNotaKait`): it never throws, files its own `JOURNAL_PENDING` (`nota_putus`) for a real
 * failure, and is off under vitest like every post-commit journal hook. Any failure is reported
 * here as NOTHING_TO_POST: passed back as a failure code, `postArJournalSafely` would file a second
 * flag for the same obstacle under the caller's kind.
 */
async function postNotaJournal(deliveryId: string, postedById: string): Promise<GenerateAutoJournalResult> {
  const r = await postingNotaKait(deliveryId, postedById);
  if (r?.ok && r.journalId) return { ok: true, journalId: r.journalId, created: r.created };
  return { ok: false, code: "NOTHING_TO_POST" };
}

type Decision = { done: GenerateAutoJournalResult } | { postNota: true };

/**
 * The nota journal is posted AFTER the lock's transaction commits, not inside it:
 * `postJurnalNota` runs its own serializable transaction that reads the same delivery row, and
 * opening it while this one still holds the row lock would wait on ourselves.
 */
async function postDeliveryJournal(
  deliveryId: string,
  postedById: string,
  half: "revenue" | "cogs",
): Promise<GenerateAutoJournalResult> {
  const decision = await runSerializable<Decision>(async (tx) => {
    if (!(await lockDelivery(tx, deliveryId))) return { done: { ok: false, code: "NOTHING_TO_POST" } };
    const s = await journalState(tx, deliveryId);
    if (s.nota) return { done: standing(s.nota) };
    const own = half === "revenue" ? s.revenue : s.cogs;
    if (own) return { done: standing(own) };
    const other = half === "revenue" ? s.cogs : s.revenue;
    if (other) {
      const done =
        half === "revenue"
          ? await postLegacyRevenue(tx, deliveryId, postedById)
          : await postLegacyCogs(tx, deliveryId, postedById);
      return { done };
    }
    return { postNota: true };
  });
  if ("done" in decision) return decision.done;
  return postNotaJournal(deliveryId, postedById);
}

/** The delivery's journal for the `field_delivery_revenue` kind — see the module comment. */
export function postFieldDeliveryRevenueJournal(deliveryId: string, postedById: string): Promise<GenerateAutoJournalResult> {
  return postDeliveryJournal(deliveryId, postedById, "revenue");
}

/** The delivery's journal for the `field_delivery_cogs` kind — see the module comment. */
export function postFieldDeliveryCogsJournal(deliveryId: string, postedById: string): Promise<GenerateAutoJournalResult> {
  return postDeliveryJournal(deliveryId, postedById, "cogs");
}
