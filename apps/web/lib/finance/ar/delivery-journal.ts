import type { Prisma } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { runSerializable } from "@/lib/db/tx-retry";

async function lockDelivery(tx: Prisma.TransactionClient, deliveryId: string): Promise<boolean> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT \`id\` FROM \`FieldSalesDelivery\` WHERE \`id\` = ${deliveryId} FOR UPDATE
  `;
  return locked.length > 0;
}

/**
 * Both journals are dated on the delivery's `invoiceDate`, which is also the date its receivable
 * ages from. A journal must never be dated by when the post happened to run: a delivery posted
 * across a month boundary would otherwise book revenue into whatever period the retry fired in.
 *
 * `updateDeliveryDatesAction` re-dates these rows when the invoice date is corrected, so the two
 * stay in agreement. Each post reads the delivery and writes its journal in one transaction whose
 * first statement locks the delivery row, so a post and a date correction serialise: a correction
 * already in flight commits before the post reads `invoiceDate`, and one arriving mid-post waits on
 * the lock and then re-dates the committed journal through its own journal `updateMany`. Dropping
 * the lock reopens a window in which the journal is dated on the old invoice date while the
 * delivery and the receivable carry the new one — a GL-vs-subledger period split nothing repairs.
 */
export async function postFieldDeliveryRevenueJournal(
  deliveryId: string,
  postedById: string,
): Promise<GenerateAutoJournalResult> {
  return runSerializable<GenerateAutoJournalResult>(async (tx) => {
    if (!(await lockDelivery(tx, deliveryId))) return { ok: false, code: "NOTHING_TO_POST" };
    const delivery = await tx.fieldSalesDelivery.findUnique({
      where: { id: deliveryId },
      select: { docNo: true, total: true, invoiceDate: true },
    });
    if (!delivery) return { ok: false, code: "NOTHING_TO_POST" };
    const value = Number(delivery.total);
    if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
    const lines = [
      { role: "AR" as const, debit: value, credit: 0 },
      { role: "SALES_REVENUE" as const, debit: 0, credit: value },
    ];
    return generateAutoJournal(tx, "FIELD_DELIVERY_REVENUE", deliveryId, lines, {
      date: delivery.invoiceDate,
      description: `Nota tagihan ${delivery.docNo}`,
      postedById,
    });
  });
}

/**
 * `cogsAmount` is null for every delivery recorded before it existed, and that resolves to
 * NOTHING_TO_POST rather than a zero-value journal. Those deliveries are unreachable from the UI
 * anyway — the retry gate requires a JOURNAL_PENDING notification, which none of them has.
 */
export async function postFieldDeliveryCogsJournal(
  deliveryId: string,
  postedById: string,
): Promise<GenerateAutoJournalResult> {
  return runSerializable<GenerateAutoJournalResult>(async (tx) => {
    if (!(await lockDelivery(tx, deliveryId))) return { ok: false, code: "NOTHING_TO_POST" };
    const delivery = await tx.fieldSalesDelivery.findUnique({
      where: { id: deliveryId },
      select: { docNo: true, cogsAmount: true, invoiceDate: true },
    });
    if (!delivery || delivery.cogsAmount === null) return { ok: false, code: "NOTHING_TO_POST" };
    const value = Number(delivery.cogsAmount);
    if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
    const lines = [
      { role: "COGS" as const, debit: value, credit: 0 },
      { role: "INVENTORY" as const, debit: 0, credit: value },
    ];
    return generateAutoJournal(tx, "FIELD_DELIVERY_COGS", deliveryId, lines, {
      date: delivery.invoiceDate,
      description: `HPP nota tagihan ${delivery.docNo}`,
      postedById,
    });
  });
}
