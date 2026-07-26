import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

async function returnMeta(returnId: string, client: AnyClient): Promise<{ date: Date; label: string } | null> {
  const ret = await client.salesReturn.findUnique({
    where: { id: returnId },
    select: { decidedAt: true, jubelioReturnNo: true },
  });
  if (!ret) return null;
  return { date: ret.decidedAt ?? new Date(), label: ret.jubelioReturnNo ?? returnId };
}

export async function postSalesReturnRevenueJournal(
  returnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const meta = await returnMeta(returnId, client);
  if (!meta) return { ok: false, code: "NOTHING_TO_POST" };
  const agg = await client.salesReturnItem.aggregate({
    where: { salesReturnId: returnId, decision: "ACCEPTED" },
    _sum: { subtotal: true },
  });
  const value = agg._sum.subtotal == null ? 0 : Number(agg._sum.subtotal);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
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
): Promise<GenerateAutoJournalResult> {
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
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
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
