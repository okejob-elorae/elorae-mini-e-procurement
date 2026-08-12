import { prisma, Prisma } from "@elorae/db";
import { parseDateOnly, formatDateOnlyJakarta } from "@/lib/date-only";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

/** SystemSetting key holding the GL go-live day as a date-only `YYYY-MM-DD` string, read as WIB. */
export const GL_CUTOVER_SETTING_KEY = "finance.glCutoverDate";

export type SalesJournalSweepResult = {
  posted: number;
  revenue: number;
  cogs: number;
  pending: number;
  /**
   * Why the sweep selected nothing, when that was a configuration state rather than
   * an empty backlog. `NO_CUTOVER` means the cutover setting is absent, empty or
   * unparseable, so a caller cannot read `posted: 0` as "nothing was due".
   */
  skipped: "NO_CUTOVER" | null;
};

/**
 * Start (00:00:00.000 WIB) of the configured GL cutover day, or null when the
 * setting is absent, empty or not an unambiguous `YYYY-MM-DD` calendar day.
 *
 * Deliberately fail-closed: books for the pre-cutover periods are kept outside this
 * system, so a missing or ambiguous floor must post nothing rather than default to
 * no floor — that default is what would let one role mapping trigger an unattended
 * retroactive backfill of the whole sales history into already-reported periods.
 *
 * The round-trip check rejects rolled-over dates (`2026-02-31` parses to 3 March),
 * which would silently move the floor.
 *
 * Exported for the sales-return journal gate, which reads it only to REPORT
 * whether a refusal is transient (the sale is above the floor and merely
 * unswept) or permanent (below it, or no floor configured at all). That gate
 * still keys on the counterpart journal, never on this date.
 */
export async function readGlCutover(): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: GL_CUTOVER_SETTING_KEY },
    select: { value: true },
  });
  const raw = row?.value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = parseDateOnly(raw);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === raw ? parsed : null;
}

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

  const salesJournalPendingNotification = await prisma.adminNotification.create({
    data: {
      category: "JOURNAL_PENDING",
      severity: "WARNING",
      title: "Sales journal not posted",
      message: `Sales ${kind} journal for ${soNumber} could not be posted (${res.code}${res.role ? `: ${res.role}` : ""}). Map the account.`,
      metadata: { orderId, kind, reason: res.code, role: res.role ?? null },
    },
  });
  await fanOutAdminNotification(salesJournalPendingNotification);
}

export async function postPendingSalesJournals(
  opts: { limit?: number; postedById?: string; orderIds?: string[] } = {},
): Promise<SalesJournalSweepResult> {
  const cutover = await readGlCutover();
  if (!cutover) return { posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: "NO_CUTOVER" };

  const limit = opts.limit ?? 50;
  let systemPoster = opts.postedById ?? null;
  if (!systemPoster) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    systemPoster = admin?.id ?? null;
  }

  // Optional scope (targeted re-post / test isolation) — without it the sweep is global.
  const idFilter =
    opts.orderIds && opts.orderIds.length > 0
      ? Prisma.sql`AND so.id IN (${Prisma.join(opts.orderIds)})`
      : Prisma.empty;

  /*
   * The cutover floor is a WHERE term, not a post-fetch filter: applied after the
   * LIMIT, a batch of 50 pre-cutover rows would fill every tick and starve eligible
   * orders forever.
   *
   * `shippedAt` is the economic date and is what the journal is dated by, but it is
   * nullable — an order can reach COMPLETED with no ship stamp. The COALESCE keeps
   * such a row in the comparison instead of dropping it, standing in the NOT NULL
   * `transactionDate`: every row is measured against SOME real date, and NULL is
   * never treated as unbounded (a bare `so.shippedAt >= ?` would make NULL fail the
   * predicate silently, and `OR shippedAt IS NULL` would let it through unmeasured).
   *
   * Do not simplify away the COALESCE. Because the transaction always precedes the
   * ship, the substitute date can only ever be EARLIER, so the fallback's only
   * possible effect is to push a row below the floor — never above it. That is the
   * intended bias: an order wrongly excluded is a visible, recoverable gap, while one
   * wrongly posted into an already-reported period cannot be undone.
   */
  const cutoverFilter = Prisma.sql`AND COALESCE(so.shippedAt, so.transactionDate) >= ${cutover}`;

  const orders = await prisma.$queryRaw<Array<{ id: string; salesorderNo: string; shippedById: string | null }>>(
    Prisma.sql`
    SELECT so.id, so.salesorderNo, so.shippedById
    FROM SalesOrder so
    WHERE (so.status IN ('SHIPPED','COMPLETED') OR so.fulfillmentStatus = 'SHIPPED')
      ${cutoverFilter}
      ${idFilter}
      AND NOT (
        EXISTS (SELECT 1 FROM Journal j  WHERE j.sourceType  = 'SALESORDER_REVENUE' AND j.sourceId  = so.id)
        AND
        EXISTS (SELECT 1 FROM Journal j2 WHERE j2.sourceType = 'SALESORDER_COGS'    AND j2.sourceId = so.id)
      )
    ORDER BY so.createdAt ASC
    LIMIT ${limit}
  `,
  );

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

  return { posted: revenue + cogs, revenue, cogs, pending, skipped: null };
}
