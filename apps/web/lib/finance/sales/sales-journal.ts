import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function postSalesRevenueJournal(
  orderId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const order = await client.salesOrder.findUnique({
    where: { id: orderId },
    select: { grandTotal: true, salesorderNo: true, shippedAt: true },
  });
  if (!order) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(order.grandTotal);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "AR" as const, debit: value, credit: 0 },
    { role: "SALES_REVENUE" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "SALESORDER_REVENUE", orderId, lines, {
    date: order.shippedAt ?? new Date(),
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
    select: { salesorderNo: true, shippedAt: true },
  });
  if (!order) return { ok: false, code: "NOTHING_TO_POST" };
  const agg = await client.salesOrderItem.aggregate({
    where: { salesOrderId: orderId },
    _sum: { cogs: true },
  });
  const value = agg._sum.cogs == null ? 0 : Number(agg._sum.cogs);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "COGS" as const, debit: value, credit: 0 },
    { role: "INVENTORY" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "SALESORDER_COGS", orderId, lines, {
    date: order.shippedAt ?? new Date(),
    description: `COGS ${order.salesorderNo}`,
    postedById,
  });
}
