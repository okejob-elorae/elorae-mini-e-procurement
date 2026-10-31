import { prisma, Prisma, sqlId } from "@elorae/db";
import { parseDateOnly, formatDateOnlyJakarta } from "@/lib/date-only";
import { postSalesRevenueJournal, postSalesCogsJournal } from "./sales-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { listJournalPendingMetadata } from "@/lib/finance/journal-pending-dedup";
import { dokumenJurnal, tandaiJurnalTertundaSelesai, type SumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";

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
 * Exported for the counterpart-journal gates — the sales-return journal gate and,
 * through the same `classifySaleLegs`, the marketplace settlement journal gate —
 * which read it only to REPORT whether a refusal is transient (the sale is above
 * the floor and merely unswept) or permanent (below it, or no floor configured at
 * all). Both still key on the counterpart journal, never on this date.
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

/**
 * The order states the sales sweep journals: `status` SHIPPED or COMPLETED, or a local
 * `fulfillmentStatus` of SHIPPED. An order outside them gets no `SALESORDER_REVENUE` or
 * `SALESORDER_COGS` journal however long it waits, so a gate that waits on one of those journals
 * must ask this, never restate it. The sweep's own query interpolates these same constants.
 */
export const SWEEP_ELIGIBLE_ORDER_STATUSES = ["SHIPPED", "COMPLETED"] as const;
export const SWEEP_ELIGIBLE_FULFILLMENT_STATUS = "SHIPPED";

export function isSweepEligibleOrder(order: { status: string; fulfillmentStatus: string }): boolean {
  return (
    (SWEEP_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status) ||
    order.fulfillmentStatus === SWEEP_ELIGIBLE_FULFILLMENT_STATUS
  );
}

/**
 * `orderId|kind` of every `JOURNAL_PENDING` row, read or unread, read ONCE per sweep tick. Read-or-unread
 * on purpose: an unread filter re-files a row the moment an operator opens the bell, so a post that keeps
 * failing would re-announce itself every tick.
 */
async function loadFlaggedSet(): Promise<Set<string>> {
  const flagged = new Set<string>();
  for (const m of await listJournalPendingMetadata()) {
    if (typeof m.orderId === "string" && typeof m.kind === "string") flagged.add(`${m.orderId}|${m.kind}`);
  }
  return flagged;
}

async function flag(
  flagged: Set<string>,
  orderId: string,
  soNumber: string,
  kind: "revenue" | "cogs",
  res: Extract<GenerateAutoJournalResult, { ok: false }>,
): Promise<void> {
  /* Dedup: file only when no JOURNAL_PENDING row of this kind exists for the order, read or unread. */
  const key = `${orderId}|${kind}`;
  if (flagged.has(key)) return;
  flagged.add(key);

  const salesJournalPendingNotification = await prisma.adminNotification.create({
    data: {
      category: "JOURNAL_PENDING",
      severity: "WARNING",
      title: "Sales journal not posted",
      message: `Sales ${kind} journal for ${soNumber} could not be posted (${res.code}${res.role ? `: ${res.role}` : ""}). Map the account.`,
      metadata: { orderId, kind, reason: res.code, role: res.role ?? null },
    },
  });
  void fanOutAdminNotification(salesJournalPendingNotification);
}

export async function postPendingSalesJournals(
  opts: { limit?: number; postedById?: string; orderIds?: string[] } = {},
): Promise<SalesJournalSweepResult> {
  if (opts.orderIds !== undefined && opts.orderIds.length === 0) {
    return { posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: null };
  }

  const cutover = await readGlCutover();
  if (!cutover) return { posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: "NO_CUTOVER" };

  const limit = opts.limit ?? 50;
  let systemPoster = opts.postedById ?? null;
  if (!systemPoster) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    systemPoster = admin?.id ?? null;
  }

  /**
   * Optional scope (targeted re-post / test isolation): only an ABSENT orderIds makes the sweep
   * global; an empty one returned above.
   */
  const idFilter =
    opts.orderIds !== undefined
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
  const cutoverFilter = Prisma.sql`AND COALESCE(so.${sqlId('shippedAt')}, so.${sqlId('transactionDate')}) >= ${cutover}`;

  /* Enum values as SQL literals, not bound parameters: PostgreSQL will not compare an enum column with a text parameter. */
  const eligibleStatuses = Prisma.raw(SWEEP_ELIGIBLE_ORDER_STATUSES.map((st) => `'${st}'`).join(", "));
  const eligibleFulfillment = Prisma.raw(`'${SWEEP_ELIGIBLE_FULFILLMENT_STATUS}'`);

  const orders = await prisma.$queryRaw<Array<{ id: string; salesorderNo: string; shippedById: string | null }>>(
    Prisma.sql`
    SELECT so.${sqlId('id')}, so.${sqlId('salesorderNo')}, so.${sqlId('shippedById')}
    FROM ${sqlId('SalesOrder')} so
    WHERE (so.${sqlId('status')} IN (${eligibleStatuses}) OR so.${sqlId('fulfillmentStatus')} = ${eligibleFulfillment})
      ${cutoverFilter}
      ${idFilter}
      AND NOT (
        EXISTS (SELECT 1 FROM ${sqlId('Journal')} j  WHERE j.${sqlId('sourceType')}  = 'SALESORDER_REVENUE' AND j.${sqlId('sourceId')}  = so.${sqlId('id')})
        AND
        EXISTS (SELECT 1 FROM ${sqlId('Journal')} j2 WHERE j2.${sqlId('sourceType')} = 'SALESORDER_COGS'    AND j2.${sqlId('sourceId')} = so.${sqlId('id')})
      )
    ORDER BY so.${sqlId('createdAt')} ASC
    LIMIT ${limit}
  `,
  );

  let revenue = 0;
  let cogs = 0;
  let pending = 0;
  const flagged = orders.length > 0 ? await loadFlaggedSet() : new Set<string>();
  // Jurnal yang berdiri sesudah sapuan ini → tanda "Jurnal gagal"-nya diselesaikan sekaligus.
  const berjurnal: SumberNotifikasiJurnal[] = [];

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
          berjurnal.push(dokumenJurnal("SALESORDER_REVENUE", order.id));
        } else if (r.code !== "NOTHING_TO_POST") {
          pending += 1;
          await flag(flagged, order.id, order.salesorderNo, "revenue", r);
        }
      }

      if (!have.has("SALESORDER_COGS")) {
        const c = await postSalesCogsJournal(order.id, poster);
        if (c.ok) {
          if (c.created) cogs += 1;
          berjurnal.push(dokumenJurnal("SALESORDER_COGS", order.id));
        } else if (c.code !== "NOTHING_TO_POST") {
          pending += 1;
          await flag(flagged, order.id, order.salesorderNo, "cogs", c);
        }
      }
    } catch (e) {
      console.error(`[sales-journal] order ${order.salesorderNo} failed:`, e);
    }
  }

  if (berjurnal.length > 0) await tandaiJurnalTertundaSelesai(berjurnal);

  return { posted: revenue + cogs, revenue, cogs, pending, skipped: null };
}
