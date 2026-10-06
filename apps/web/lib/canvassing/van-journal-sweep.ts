import { prisma, Prisma } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { postVanLoadJournal, postVanSaleJournal, postVanReconcileJournal } from "./van-journal";
import { postVanJournalSafely } from "./post-van-journal-safely";
import type { VanJournalKind } from "./journal-pending";

export type VanJournalSweepScope = { load?: string[]; sale?: string[]; reconcile?: string[] };

export type VanJournalSweepResult = {
  posted: number;
  /**
   * Documents whose poster answered `NOTHING_TO_POST`: they passed the value
   * prefilter but round to nothing (the half-cent residual on `findCandidates`).
   * Neither a post nor a failure, and re-attempted every tick.
   */
  nothingToPost: number;
  failed: number;
  newlyFlagged: number;
  /**
   * `NO_FLOOR` means no van document has ever been auto-posted (or flagged) in
   * this environment, so nothing can be proven safe to sweep.
   */
  skipped: "NO_FLOOR" | null;
};

type DocKind = "load" | "sale" | "reconcile";

export const VAN_JOURNAL_SWEEP_SETTLE_MS = 15 * 60 * 1000;

/**
 * When van journal auto-posting was committed. No environment auto-posted a van
 * document before it, so the floor never needs to sit below it.
 */
export const VAN_AUTO_POST_SHIPPED_AT = new Date("2026-08-05T06:41:30Z");

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

type FlaggedDocIds = Record<VanJournalKind, string[]>;

/**
 * Every van document named by a `JOURNAL_PENDING` row, read or unread, per kind.
 *
 * Reads every row with no `take`: a capped window could drop the row that names
 * the earliest document (same reasoning as `findPostableJournalDocIds`).
 * Metadata is matched in JS because JSON-path filtering on this adapter is
 * unreliable.
 */
async function readFlaggedDocIds(): Promise<FlaggedDocIds> {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { metadata: true },
  });
  const flagged: Record<VanJournalKind, Set<string>> = { van_load: new Set(), van_sale: new Set(), van_reconcile: new Set() };
  for (const r of rows) {
    const m = r.metadata as { docId?: unknown; kind?: unknown } | null;
    const docId = m?.docId;
    const kind = m?.kind;
    if (typeof docId !== "string") continue;
    if (kind === "van_load" || kind === "van_sale" || kind === "van_reconcile") flagged[kind].add(docId);
  }
  return { van_load: [...flagged.van_load], van_sale: [...flagged.van_sale], van_reconcile: [...flagged.van_reconcile] };
}

/**
 * The minimum of (a) the earliest van journal's date, which is its document's
 * own `createdAt`, and (b) the earliest document named by a van-kind
 * `JOURNAL_PENDING` row. `null` when neither exists.
 */
async function deriveFloor(flagged: FlaggedDocIds): Promise<Date | null> {
  const candidates: Date[] = [];

  const journals = await prisma.journal.aggregate({
    where: { sourceType: { in: ["VAN_LOAD", "VAN_SALE", "VAN_RECONCILE"] } },
    _min: { date: true },
  });
  if (journals._min.date) candidates.push(journals._min.date);

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
 * Raises a derived floor to `VAN_AUTO_POST_SHIPPED_AT`, never lowers it, and
 * keeps `null` as `null`. A van-sale idempotent replay across the deploy can
 * post a journal dated before the deploy and pull the derived floor down.
 */
export function clampVanJournalSweepFloor(derived: Date | null): Date | null {
  if (derived === null) return null;
  return derived.getTime() < VAN_AUTO_POST_SHIPPED_AT.getTime() ? VAN_AUTO_POST_SHIPPED_AT : derived;
}

/**
 * The earliest van document `createdAt` that auto-posting demonstrably reached
 * (`deriveFloor`), raised to `VAN_AUTO_POST_SHIPPED_AT` when it derives lower.
 * `null` when nothing derives.
 *
 * Invariant: every document at or after the floor was created by code that
 * auto-posted its journal, so posting one can never be the one-sided replay
 * `journal-pending.ts` forbids. Never lower this floor or replace the
 * derivation with a fixed date: the derivation is what makes it exact in every
 * environment, and the fixed date may only ever raise it.
 */
export async function vanJournalSweepFloor(): Promise<Date | null> {
  return clampVanJournalSweepFloor(await deriveFloor(await readFlaggedDocIds()));
}

/** Which slice of a kind's candidates one query reads: the unflagged ones, or the flagged retries. */
type CandidateWindow = { flagged: boolean; flaggedIds: string[] };

/**
 * The id restrictions shared by every kind's candidate query. `alias` is one of
 * this module's own table aliases, never caller input. A flagged window must
 * carry at least one id, since an empty `IN ()` is invalid SQL.
 */
function windowFilter(alias: "vl" | "vs" | "vr", scopeIds: string[] | undefined, window: CandidateWindow): Prisma.Sql {
  const col = Prisma.raw(`${alias}.id`);
  const scope = scopeIds !== undefined ? Prisma.sql`AND ${col} IN (${Prisma.join(scopeIds)})` : Prisma.empty;
  if (window.flagged) return Prisma.sql`${scope} AND ${col} IN (${Prisma.join(window.flaggedIds)})`;
  if (window.flaggedIds.length === 0) return scope;
  return Prisma.sql`${scope} AND ${col} NOT IN (${Prisma.join(window.flaggedIds)})`;
}

/**
 * Unjournaled documents of one kind at or above the floor and created before
 * `settledBefore`, restricted to one `CandidateWindow`, oldest first.
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
  settledBefore: Date,
  scopeIds: string[] | undefined,
  window: CandidateWindow,
  limit: number,
): Promise<Array<{ id: string; actorId: string }>> {
  if (kind === "load") {
    const idFilter = windowFilter("vl", scopeIds, window);
    return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
      SELECT vl.id, vl.loadedById AS actorId
      FROM VanLoad vl
      JOIN VanLoadLine l ON l.vanLoadId = vl.id
      WHERE vl.createdAt >= ${floor}
        AND vl.createdAt < ${settledBefore}
        ${idFilter}
        AND NOT EXISTS (SELECT 1 FROM Journal j WHERE j.sourceType = 'VAN_LOAD' AND j.sourceId = vl.id)
      GROUP BY vl.id, vl.loadedById, vl.createdAt
      HAVING SUM(ROUND(l.qty * l.unitCost, 2)) >= 0.01
      ORDER BY vl.createdAt ASC
      LIMIT ${limit}
    `);
  }
  if (kind === "sale") {
    const idFilter = windowFilter("vs", scopeIds, window);
    return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
      SELECT vs.id, vs.salesmanId AS actorId
      FROM VanSale vs
      LEFT JOIN VanSaleLine l ON l.vanSaleId = vs.id
      WHERE vs.createdAt >= ${floor}
        AND vs.createdAt < ${settledBefore}
        ${idFilter}
        AND NOT EXISTS (SELECT 1 FROM Journal j WHERE j.sourceType = 'VAN_SALE' AND j.sourceId = vs.id)
      GROUP BY vs.id, vs.salesmanId, vs.total, vs.createdAt
      HAVING vs.total >= 0.01 OR COALESCE(SUM(ROUND(l.qty * l.unitCost, 2)), 0) >= 0.01
      ORDER BY vs.createdAt ASC
      LIMIT ${limit}
    `);
  }
  const idFilter = windowFilter("vr", scopeIds, window);
  return prisma.$queryRaw<Array<{ id: string; actorId: string }>>(Prisma.sql`
    SELECT vr.id, vr.reconciledById AS actorId
    FROM VanReconcile vr
    JOIN VanReconcileLine l ON l.vanReconcileId = vr.id
    WHERE vr.createdAt >= ${floor}
      AND vr.createdAt < ${settledBefore}
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
 * unjournaled van document above the floor. Each kind reads two windows of up
 * to `limit` documents, unflagged documents first and flagged retries second, so
 * flagged documents that fail every tick (an unmapped role, say) can never
 * occupy the window an unflagged one needs.
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
 * Only documents older than `VAN_JOURNAL_SWEEP_SETTLE_MS` are considered, so the
 * sweep never races the creating action's own journal post: a document picked up
 * between its creation commit and that post would lose on the journal's unique
 * constraint and file a false `JOURNAL_PENDING` row.
 *
 * `scope` absent makes the sweep global (the cron). `scope` present restricts it
 * to the listed ids: a kind whose array is absent or empty sweeps nothing, and an
 * all-empty scope returns before any read. Specs must always pass a scope, since
 * the test bed holds real documents.
 */
export async function postPendingVanJournals(
  opts: { scope?: VanJournalSweepScope; limit?: number; now?: Date } = {},
): Promise<VanJournalSweepResult> {
  const result: VanJournalSweepResult = { posted: 0, nothingToPost: 0, failed: 0, newlyFlagged: 0, skipped: null };
  const { scope } = opts;

  const kinds = scope === undefined ? KINDS : KINDS.filter((k) => (scope[k]?.length ?? 0) > 0);
  if (kinds.length === 0) return result;

  const flagged = await readFlaggedDocIds();
  const floor = clampVanJournalSweepFloor(await deriveFloor(flagged));
  if (!floor) return { ...result, skipped: "NO_FLOOR" };

  const limit = opts.limit ?? 50;
  const settledBefore = new Date((opts.now ?? new Date()).getTime() - VAN_JOURNAL_SWEEP_SETTLE_MS);

  for (const kind of kinds) {
    const flaggedIds = flagged[NOTIFICATION_KIND[kind]];
    const scopeIds = scope === undefined ? undefined : scope[kind];

    const unflagged = await findCandidates(kind, floor, settledBefore, scopeIds, { flagged: false, flaggedIds }, limit);
    for (const { id, actorId } of unflagged) {
      try {
        /* The poster reports NOTHING_TO_POST as `null`, like a post; capture the result to tell them apart. */
        const seen: { result?: GenerateAutoJournalResult } = {};
        const failure = await postVanJournalSafely(kind, id, async () => {
          seen.result = await POST[kind](id, actorId);
          return seen.result;
        });
        if (failure !== null) {
          result.failed += 1;
          result.newlyFlagged += 1;
        } else if (seen.result && !seen.result.ok && seen.result.code === "NOTHING_TO_POST") {
          result.nothingToPost += 1;
        } else {
          result.posted += 1;
        }
      } catch (e) {
        result.failed += 1;
        console.error(`[van-journal-sweep] ${kind} ${id} failed:`, e);
      }
    }

    if (flaggedIds.length === 0) continue;
    const retries = await findCandidates(kind, floor, settledBefore, scopeIds, { flagged: true, flaggedIds }, limit);
    for (const { id, actorId } of retries) {
      try {
        /* Already flagged: retry the post, but never file another row for it. */
        const res = await POST[kind](id, actorId);
        if (res.ok) result.posted += 1;
        else if (res.code === "NOTHING_TO_POST") result.nothingToPost += 1;
        else result.failed += 1;
      } catch (e) {
        result.failed += 1;
        console.error(`[van-journal-sweep] ${kind} ${id} failed:`, e);
      }
    }
  }

  return result;
}
