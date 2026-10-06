import { prisma, Prisma } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { postVanLoadJournal, postVanSaleJournal, postVanReconcileJournal } from "./van-journal";
import { postVanJournalSafely } from "./post-van-journal-safely";
import { findPostableJournalDocIds, type VanJournalKind } from "./journal-pending";

export type VanJournalSweepScope = { load?: string[]; sale?: string[]; reconcile?: string[] };

export type VanJournalSweepResult = {
  posted: number;
  failed: number;
  newlyFlagged: number;
  /**
   * `NO_FLOOR` means no van document has ever been auto-posted (or flagged) in
   * this environment, so nothing can be proven safe to sweep.
   */
  skipped: "NO_FLOOR" | null;
};

type DocKind = "load" | "sale" | "reconcile";

const KINDS: DocKind[] = ["load", "sale", "reconcile"];

const NOTIFICATION_KIND: Record<DocKind, VanJournalKind> = {
  load: "van_load",
  sale: "van_sale",
  reconcile: "van_reconcile",
};

const POST: Record<DocKind, (id: string, postedById: string) => Promise<GenerateAutoJournalResult>> = {
  load: (id, postedById) => postVanLoadJournal(id, postedById),
  sale: (id, postedById) => postVanSaleJournal(id, postedById),
  reconcile: (id, postedById) => postVanReconcileJournal(id, postedById),
};

/**
 * The earliest van document `createdAt` that auto-posting demonstrably reached:
 * the minimum of (a) the earliest van journal's date, which is its document's
 * own `createdAt`, and (b) the earliest document named by a van-kind
 * `JOURNAL_PENDING` row. `null` when neither exists.
 *
 * Invariant: every document at or after the floor was created by code that
 * auto-posted its journal, so posting one can never be the one-sided replay
 * `journal-pending.ts` forbids. Never lower this floor or replace it with a
 * fixed date: the derivation is what makes it exact in every environment.
 *
 * Reads every `JOURNAL_PENDING` row with no `take`: a capped window could drop
 * the row that names the earliest document (same reasoning as
 * `findPostableJournalDocIds`). Metadata is matched in JS because JSON-path
 * filtering on this adapter is unreliable.
 */
export async function vanJournalSweepFloor(): Promise<Date | null> {
  const candidates: Date[] = [];

  const journals = await prisma.journal.aggregate({
    where: { sourceType: { in: ["VAN_LOAD", "VAN_SALE", "VAN_RECONCILE"] } },
    _min: { date: true },
  });
  if (journals._min.date) candidates.push(journals._min.date);

  const rows = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { metadata: true },
  });
  const flagged: Record<VanJournalKind, string[]> = { van_load: [], van_sale: [], van_reconcile: [] };
  for (const r of rows) {
    const m = r.metadata as { docId?: unknown; kind?: unknown } | null;
    const docId = m?.docId;
    const kind = m?.kind;
    if (typeof docId !== "string") continue;
    if (kind === "van_load" || kind === "van_sale" || kind === "van_reconcile") flagged[kind].push(docId);
  }

  if (flagged.van_load.length > 0) {
    const a = await prisma.vanLoad.aggregate({ where: { id: { in: flagged.van_load } }, _min: { createdAt: true } });
    if (a._min.createdAt) candidates.push(a._min.createdAt);
  }
  if (flagged.van_sale.length > 0) {
    const a = await prisma.vanSale.aggregate({ where: { id: { in: flagged.van_sale } }, _min: { createdAt: true } });
    if (a._min.createdAt) candidates.push(a._min.createdAt);
  }
  if (flagged.van_reconcile.length > 0) {
    const a = await prisma.vanReconcile.aggregate({
      where: { id: { in: flagged.van_reconcile } },
      _min: { createdAt: true },
    });
    if (a._min.createdAt) candidates.push(a._min.createdAt);
  }

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((c) => c.getTime())));
}

/**
 * Unjournaled documents of one kind at or above the floor, oldest first.
 *
 * The value prefilter keeps a permanently zero-value document from occupying a
 * `LIMIT` slot forever (prod's `avgCost` is 0 almost everywhere, so without it
 * every load would be a candidate that posts nothing). It mirrors the per-line
 * cent rounding in `van-journal-values.ts`.
 *
 * Known residual: MariaDB `ROUND` is half-away-from-zero, while JS `Math.round`
 * rounds a negative half toward zero, so a reconcile whose variance is exactly a
 * negative half-cent can pass this prefilter and still come back
 * `NOTHING_TO_POST` from the poster.
 *
 * Built as one `Prisma.sql` from this module and passed as the single argument
 * to `$queryRaw`: a fragment from another Prisma runtime copy would bind as a
 * string and silently match nothing.
 */
async function findCandidates(
  kind: DocKind,
  floor: Date,
  ids: string[] | undefined,
  limit: number,
): Promise<Array<{ id: string; actorId: string }>> {
  if (kind === "load") {
    const idFilter = ids !== undefined ? Prisma.sql`AND vl.id IN (${Prisma.join(ids)})` : Prisma.empty;
    return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
      SELECT vl.id, vl.loadedById AS actorId
      FROM VanLoad vl
      JOIN VanLoadLine l ON l.vanLoadId = vl.id
      WHERE vl.createdAt >= ${floor}
        ${idFilter}
        AND NOT EXISTS (SELECT 1 FROM Journal j WHERE j.sourceType = 'VAN_LOAD' AND j.sourceId = vl.id)
      GROUP BY vl.id, vl.loadedById, vl.createdAt
      HAVING SUM(ROUND(l.qty * l.unitCost, 2)) >= 0.01
      ORDER BY vl.createdAt ASC
      LIMIT ${limit}
    `);
  }
  if (kind === "sale") {
    const idFilter = ids !== undefined ? Prisma.sql`AND vs.id IN (${Prisma.join(ids)})` : Prisma.empty;
    return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
      SELECT vs.id, vs.salesmanId AS actorId
      FROM VanSale vs
      LEFT JOIN VanSaleLine l ON l.vanSaleId = vs.id
      WHERE vs.createdAt >= ${floor}
        ${idFilter}
        AND NOT EXISTS (SELECT 1 FROM Journal j WHERE j.sourceType = 'VAN_SALE' AND j.sourceId = vs.id)
      GROUP BY vs.id, vs.salesmanId, vs.total, vs.createdAt
      HAVING vs.total >= 0.01 OR COALESCE(SUM(ROUND(l.qty * l.unitCost, 2)), 0) >= 0.01
      ORDER BY vs.createdAt ASC
      LIMIT ${limit}
    `);
  }
  const idFilter = ids !== undefined ? Prisma.sql`AND vr.id IN (${Prisma.join(ids)})` : Prisma.empty;
  return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
    SELECT vr.id, vr.reconciledById AS actorId
    FROM VanReconcile vr
    JOIN VanReconcileLine l ON l.vanReconcileId = vr.id
    WHERE vr.createdAt >= ${floor}
      ${idFilter}
      AND NOT EXISTS (SELECT 1 FROM Journal j WHERE j.sourceType = 'VAN_RECONCILE' AND j.sourceId = vr.id)
    GROUP BY vr.id, vr.reconciledById, vr.createdAt
    HAVING SUM(ROUND(l.countedQty * l.unitCost, 2)) >= 0.01
      OR ABS(SUM(ROUND(l.varianceQty * l.unitCost, 2))) >= 0.01
    ORDER BY vr.createdAt ASC
    LIMIT ${limit}
  `);
}

/**
 * Backstop for van load/sale/reconcile journals: posts the journal of every
 * unjournaled van document above the floor, up to `limit` per kind.
 *
 * Every van document posts its journal at the moment of action through
 * `postVanJournalSafely`, and a failed post files a `JOURNAL_PENDING` row that
 * gates the retry button. When that notification write ALSO fails (the catch in
 * `post-van-journal-safely.ts`'s `notify`), the document is left with no journal,
 * no row and no retry button. This sweep is what re-attempts it.
 *
 * A missing journal is a safe trigger here ONLY above `vanJournalSweepFloor()`.
 * A van document created before auto-posting existed has no journal either, and
 * posting it now would replay a one-sided entry (`journal-pending.ts`).
 *
 * Write rule: a `JOURNAL_PENDING` row is filed only for a document that has none
 * at all, read or unread. A failed post for an already-flagged document writes
 * nothing, so a post that keeps failing does not re-file a row every tick once
 * its row is read or ages out of `postVanJournalSafely`'s unread dedup window.
 *
 * Not gated on `finance.glCutoverDate`, consistent with every other van journal:
 * `van-journal.ts` never reads it.
 *
 * `scope` absent makes the sweep global (the cron). `scope` present restricts it
 * to the listed ids: a kind whose array is absent or empty sweeps nothing, and an
 * all-empty scope returns before any read. Specs must always pass a scope, since
 * the test bed holds real documents.
 */
export async function postPendingVanJournals(
  opts: { scope?: VanJournalSweepScope; limit?: number } = {},
): Promise<VanJournalSweepResult> {
  const result: VanJournalSweepResult = { posted: 0, failed: 0, newlyFlagged: 0, skipped: null };
  const { scope } = opts;

  const kinds = scope === undefined ? KINDS : KINDS.filter((k) => (scope[k]?.length ?? 0) > 0);
  if (kinds.length === 0) return result;

  const floor = await vanJournalSweepFloor();
  if (!floor) return { ...result, skipped: "NO_FLOOR" };

  const limit = opts.limit ?? 50;

  for (const kind of kinds) {
    const candidates = await findCandidates(kind, floor, scope === undefined ? undefined : scope[kind], limit);
    if (candidates.length === 0) continue;

    const flagged = await findPostableJournalDocIds(
      NOTIFICATION_KIND[kind],
      candidates.map((c) => c.id),
    );

    for (const { id, actorId } of candidates) {
      try {
        if (!flagged.has(id)) {
          const failure = await postVanJournalSafely(kind, id, () => POST[kind](id, actorId));
          if (failure === null) {
            result.posted += 1;
          } else {
            result.failed += 1;
            result.newlyFlagged += 1;
          }
        } else {
          /* Already flagged: retry the post, but never file another row for it. */
          const res = await POST[kind](id, actorId);
          if (res.ok) result.posted += 1;
          else result.failed += 1;
        }
      } catch (e) {
        result.failed += 1;
        console.error(`[van-journal-sweep] ${kind} ${id} failed:`, e);
      }
    }
  }

  return result;
}
