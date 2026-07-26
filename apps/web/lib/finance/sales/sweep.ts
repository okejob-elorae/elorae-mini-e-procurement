import { prisma } from "@elorae/db";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

async function flag(
  orderId: string,
  soNumber: string,
  kind: "revenue" | "cogs",
  res: Extract<GenerateAutoJournalResult, { ok: false }>,
): Promise<void> {
  // Dedup: at most one unread JOURNAL_PENDING per (orderId, kind). MariaDB JSON-path
  // filtering on this adapter is unreliable, so fetch recent unread rows and dedup in JS.
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  const already = recent.some((n) => {
    const m = n.metadata as { orderId?: string; kind?: string } | null;
    return m?.orderId === orderId && m?.kind === kind;
  });
  if (already) return;

  await prisma.adminNotification.create({
    data: {
      category: "JOURNAL_PENDING",
      severity: "WARNING",
      title: "Sales journal not posted",
      message: `Sales ${kind} journal for ${soNumber} could not be posted (${res.code}${res.role ? `: ${res.role}` : ""}). Map the account.`,
      metadata: { orderId, kind, reason: res.code, role: res.role ?? null },
    },
  });
}

export async function postPendingSalesJournals(
  opts: { limit?: number; postedById?: string } = {},
): Promise<{ posted: number; revenue: number; cogs: number; pending: number }> {
  const limit = opts.limit ?? 50;
  let systemPoster = opts.postedById ?? null;
  if (!systemPoster) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    systemPoster = admin?.id ?? null;
  }

  const orders = await prisma.salesOrder.findMany({
    where: { status: { in: ["SHIPPED", "COMPLETED"] } },
    select: { id: true, salesorderNo: true, shippedById: true },
    orderBy: { shippedAt: "asc" },
    take: limit,
  });

  let revenue = 0;
  let cogs = 0;
  let pending = 0;

  for (const order of orders) {
    const poster = order.shippedById ?? systemPoster;
    if (!poster) continue; // cannot post without a user

    try {
      const existing = await prisma.journal.findMany({
        where: { sourceType: { in: ["SALESORDER_REVENUE", "SALESORDER_COGS"] }, sourceId: order.id },
        select: { sourceType: true },
      });
      const have = new Set(existing.map((e) => e.sourceType));

      if (!have.has("SALESORDER_REVENUE")) {
        const r = await postSalesRevenueJournal(order.id, poster);
        if (r.ok) {
          if (r.created) revenue += 1;
        } else if (r.code !== "NOTHING_TO_POST") {
          pending += 1;
          await flag(order.id, order.salesorderNo, "revenue", r);
        }
      }

      if (!have.has("SALESORDER_COGS")) {
        const c = await postSalesCogsJournal(order.id, poster);
        if (c.ok) {
          if (c.created) cogs += 1;
        } else if (c.code !== "NOTHING_TO_POST") {
          pending += 1;
          await flag(order.id, order.salesorderNo, "cogs", c);
        }
      }
    } catch (e) {
      console.error(`[sales-journal] order ${order.salesorderNo} failed:`, e);
    }
  }

  return { posted: revenue + cogs, revenue, cogs, pending };
}
