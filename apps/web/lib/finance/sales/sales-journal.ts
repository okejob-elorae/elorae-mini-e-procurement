import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { nilaiPerPeranPersediaan } from "@/lib/finance/journals/peran-persediaan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * The date a sale's journals are booked on: the ship stamp when there is one,
 * otherwise the order's own `transactionDate`.
 *
 * It has to be the same date the GL cutover floor measures the order by —
 * `sweep.ts`'s `COALESCE(so.shippedAt, so.transactionDate)` — or the sweep
 * admits an order on one date and books it on another. `shippedAt` is nullable
 * and an order can reach COMPLETED with no ship stamp, so the fallback is not
 * hypothetical.
 *
 * `new Date()` remains only for a row carrying neither date, which the schema
 * does not allow (`transactionDate` is NOT NULL). A journal must never be dated
 * by when the cron happened to fire: that books revenue into whatever period
 * the sweep ran in rather than the period the sale belongs to, and a sale that
 * sat unposted across a month boundary would land in the wrong month silently.
 */
export function saleGlDate(order: { shippedAt: Date | null; transactionDate: Date | null }): Date {
  return order.shippedAt ?? order.transactionDate ?? new Date();
}

export async function postSalesRevenueJournal(
  orderId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const order = await client.salesOrder.findUnique({
    where: { id: orderId },
    select: { grandTotal: true, salesorderNo: true, shippedAt: true, transactionDate: true },
  });
  if (!order) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(order.grandTotal);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "AR" as const, debit: value, credit: 0 },
    { role: "SALES_REVENUE" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "SALESORDER_REVENUE", orderId, lines, {
    date: saleGlDate(order),
    description: `Sale ${order.salesorderNo}`,
    postedById,
  });
}

export async function postSalesCogsJournal(
  orderId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const order = await client.salesOrder.findUnique({
    where: { id: orderId },
    select: { salesorderNo: true, shippedAt: true, transactionDate: true },
  });
  if (!order) return { ok: false, code: "NOTHING_TO_POST" };
  const items = await client.salesOrderItem.findMany({
    where: { salesOrderId: orderId, cogs: { not: null } },
    select: { itemId: true, cogs: true },
  });
  // Persediaan yang dikredit mengikuti tipe barangnya: barang jadi keluar dari
  // `INVENTORY_FG`, tempat penerimaan barang jadi mendebitnya (peran-persediaan.ts).
  const itemIds = [...new Set(items.map((i) => i.itemId).filter((id): id is string => !!id))];
  const tipe = new Map(
    itemIds.length
      ? (await client.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, type: true } })).map((i) => [i.id, i.type as string])
      : [],
  );
  const perPeran = nilaiPerPeranPersediaan(items.map((i) => ({ tipeBarang: i.itemId ? tipe.get(i.itemId) : null, nilai: Number(i.cogs) })));
  const value = perPeran.reduce((s, p) => s + Math.round(p.nilai * 100), 0) / 100;
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "COGS" as const, debit: value, credit: 0 },
    ...perPeran.map((p) => ({ role: p.role, debit: 0, credit: p.nilai })),
  ];
  return generateAutoJournal(client, "SALESORDER_COGS", orderId, lines, {
    date: saleGlDate(order),
    description: `COGS ${order.salesorderNo}`,
    postedById,
  });
}
