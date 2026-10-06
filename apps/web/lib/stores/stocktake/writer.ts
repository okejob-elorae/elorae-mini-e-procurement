import { Prisma, setStoreStock } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { buildStocktakeLines, previousApprovedCountedAt } from "./queries";
import { StoreStocktakeError } from "./errors";
import { resolveLineCountMoment } from "./count-moment";
import { bookedCountCents, stockMatchKey, sumMovementsSinceCountCents, type CountMomentLine } from "./booked";

type CauseValue = "SHRINKAGE" | "UNRECORDED_SALE";

type AddedLineInput = {
  itemId: string;
  variantSku: string;
  countedQty: number | null;
  cause?: CauseValue | null;
  reason?: string | null;
  countedAtMs?: number;
};

/**
 * Opens a new count for a store. Refused with `ALREADY_OPEN` when the store already has a
 * document whose `openKey` is non-null — the explicit check exists only to return a readable
 * code; the real guard is the `@unique` constraint on `openKey` itself, which is what actually
 * enforces one open stocktake per store under concurrent creation. Two concurrent callers can
 * both pass the `findFirst` above before either commits — the loser's `create` then violates the
 * `openKey` unique constraint, so that P2002 is caught and mapped to the same `ALREADY_OPEN`
 * rather than escaping as an opaque digest.
 *
 * `periodFrom` falls out of the store's previous APPROVED count rather than being supplied by
 * the caller, so the sold-in-window figures on the lines below are never a caller-chosen range.
 *
 * `note` is optional free text shown on the detail screen; the daily count sweep uses it to mark a
 * count it opened.
 */
export async function createStoreStocktake(input: {
  storeId: string;
  createdById: string;
  countedAt: Date;
  note?: string;
}): Promise<{ id: string; docNo: string }> {
  return runSerializable(async (tx) => {
    const open = await tx.storeStocktake.findFirst({
      where: { storeId: input.storeId, openKey: { not: null } },
      select: { id: true },
    });
    if (open) throw new StoreStocktakeError("ALREADY_OPEN");

    const periodFrom = await previousApprovedCountedAt(tx, input.storeId);
    const draftLines = await buildStocktakeLines(tx, input.storeId, periodFrom, input.countedAt);
    const docNo = await generateDocNumber("STOCKTAKE", tx);

    try {
      const created = await tx.storeStocktake.create({
        data: {
          docNo,
          storeId: input.storeId,
          openKey: input.storeId,
          countedAt: input.countedAt,
          periodFrom,
          createdById: input.createdById,
          note: input.note ?? null,
          lines: {
            create: draftLines.map((l) => ({
              itemId: l.itemId,
              variantSku: l.variantSku,
              productName: l.productName,
              expectedQty: l.expectedQty,
              soldInPeriodQty: l.soldInPeriodQty,
              countedQty: null,
            })),
          },
        },
        select: { id: true, docNo: true },
      });

      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new StoreStocktakeError("ALREADY_OPEN");
      }
      throw e;
    }
  });
}

/**
 * Writes counts onto an already-open document. Never touches `StoreStock` — a save is a claim,
 * not yet the truth; only `approveStoreStocktake` writes the ledger. `varianceQty` is
 * recomputed here too (`counted − expected`) purely so the detail page can show a variance before
 * approval — approval does not trust this value: it gates on, and stores, the delta it actually
 * books (`bookedCountCents`).
 *
 * Every save that stamps the count — one that changes any line's figure or adds a line — also
 * re-baselines `expectedQty` on EVERY line of the document, not only the lines it was sent, and
 * recomputes each `varianceQty` from the line's own `countedQty`. A line's new `expectedQty` is
 * the store's live `StoreStock` qty for its `itemId::variantSku`, read inside this transaction,
 * MINUS every store movement after that line's count moment (`sumMovementsSinceCountCents`, the
 * same rows and the same exclusions approval re-applies) — so it is what the shelf should have
 * held at the moment it was counted. Approval sets `countedQty` plus those same movements, so the
 * ledger row it writes is `countedQty − expectedQty`: the variance the counter and the admin saw
 * here. A movement after this save cancels out of that (it is in live stock and in the re-applied
 * movements alike), except a row the count had already seen that only lands later — a retur
 * raised before the count and settled after this save, say — which is why approval gates and
 * stores the delta it actually books rather than this figure. The opening snapshot alone would go
 * stale: a sale or a delivery between the document opening and the count would read as shrinkage
 * or surplus, and demand a cause for a shortfall that never happened. A line
 * whose moment is this save's instant is simply its live qty; an uncounted line, having no moment,
 * takes its live qty too, so it shows what to count against; a key with no `StoreStock` row at
 * all re-baselines to `0`. A line this save was not sent keeps its cause and reason as they were,
 * even where a new baseline makes one moot: approval only demands them, never refuses one that is
 * present. A line it was sent takes the cause and reason it was sent, null included.
 *
 * A save that changes only causes or reasons re-baselines nothing: it stamps nothing (below), and
 * moving the baseline under an admin who is only filling in why a line is short would change the
 * variance they are explaining.
 *
 * `addedLines` is the add-item picker's path: a line for an item that was not on the document's
 * own snapshot. Its `expectedQty` comes from the same live read as every other line — never a
 * hardcoded `0`, which is only the fallback for a key the store has genuinely never held stock
 * for: the SPG's own screen renders from live stock, so a pair that lands here as "added" may
 * still have real expected stock, and seeding `0` would misreport a shortfall as a surplus.
 * `productName` is resolved from `Item` the same way `buildStocktakeLines` fills it.
 * `approveStoreStocktake`'s `SHORTFALL_NEEDS_CAUSE` check then fires on an added line exactly as
 * it would have had the line existed on the original snapshot. The reason check is NOT enforced
 * here at save time — see the comment at the added-lines block below for why — only the
 * structural guards (`ITEM_NOT_FOUND`, `DUPLICATE_LINE`) are.
 *
 * Each line carries its own `countFinishedAt`, the moment its counted figure is true:
 * `approveStoreStocktake` re-applies every store movement recorded after THAT LINE's moment. It is
 * stamped only on a line whose `countedQty` this save actually changes (compared in cents), and on
 * every added line — with this save's instant, or the moment the SPG sheet says that row was
 * counted (below) — and cleared when the count is cleared. A line the save leaves at the same
 * figure keeps its stamp, so an admin correcting one line at verification never moves the count
 * moment of every other line: the backoffice resends every line whenever it saves, and re-stamping
 * them all would silently drop every sale or delivery between their physical count and that edit.
 *
 * The document's own `countFinishedAt` is stamped with the same instant whenever any figure
 * changes, and the last such save wins: it stays "when the count last changed", which is what the
 * `TRANSFER_PENDING` refusal here, `approveStoreTransfer`'s `COUNTED_SINCE_MOVE`, the sell-through
 * in-flight checks and the konsi count schedule read. A save that changes only causes or reasons
 * leaves it alone, for the same reason as the line stamps.
 *
 * `clientClock` is the SPG sheet's: the device time it sent the request and the server time the
 * action received it. With it, a changed line carrying `countedAtMs` — the device time that row's
 * figure was last edited — is stamped at that moment moved onto the server clock and clamped
 * (`resolveLineCountMoment`), because the sheet submits once at the end and a sale between
 * counting a shelf and submitting would otherwise read as a surplus. Without `clientClock`, or for
 * a line with no usable `countedAtMs`, the line gets this save's instant. The admin path never
 * sends one: an admin's correction is true as of the save. Device times never touch the
 * document's own stamp.
 */
export async function saveStocktakeCounts(input: {
  stocktakeId: string;
  lines: Array<{ lineId: string; countedQty: number | null; cause?: CauseValue | null; reason?: string | null; countedAtMs?: number }>;
  addedLines?: AddedLineInput[];
  submit: boolean;
  userId: string;
  clientClock?: { sentAtMs: number; receivedAtMs: number };
}): Promise<{ ok: true; status: string }> {
  return runSerializable(async (tx) => {
    /* One instant for every stamp this save writes, so the document's stamp equals its lines'. */
    const now = new Date();

    const st = await tx.storeStocktake.findUnique({
      where: { id: input.stocktakeId },
      select: {
        id: true,
        storeId: true,
        status: true,
        lines: { select: { id: true, itemId: true, variantSku: true, expectedQty: true, countedQty: true, countFinishedAt: true } },
      },
    });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    /*
     * A device-reported count moment is never allowed before the store's previous approval: that
     * approval SET the balance, so a moment before it would have this count re-apply movements the
     * previous count already absorbed (approval also skips earlier counts' own ledger rows — see
     * `sumMovementsSinceCountCents`). Anything the device sent that cannot be used falls back to
     * the server instant, which is exactly what a line got before device times were sent at all.
     */
    const clientClock = input.clientClock;
    let lowerBound: Date | null = null;
    if (clientClock) {
      const previous = await tx.storeStocktake.findFirst({
        where: { storeId: st.storeId, status: "APPROVED" },
        orderBy: { approvedAt: "desc" },
        select: { approvedAt: true },
      });
      lowerBound = previous?.approvedAt ?? null;
    }
    const momentOf = (countedAtMs: number | undefined): Date => {
      if (!clientClock || countedAtMs === undefined) return now;
      const moment = resolveLineCountMoment({
        countedAtMs,
        clientSentAtMs: clientClock.sentAtMs,
        receivedAtMs: clientClock.receivedAtMs,
        lowerBound,
      });
      return moment ?? now;
    };

    const storedLineById = new Map(st.lines.map((l) => [l.id, l]));

    /*
     * Every line id must already belong to this document, and every countedQty must be a
     * non-negative finite number (or null). Both are shape checks on a payload nothing else
     * validates before it reaches here, so a bad one is INVALID_REQUEST, never a domain code
     * that would misdescribe a malformed request as a legitimate refusal.
     */
    for (const line of input.lines) {
      if (!storedLineById.has(line.lineId)) throw new StoreStocktakeError("INVALID_REQUEST");
      if (line.countedQty !== null && (typeof line.countedQty !== "number" || !Number.isFinite(line.countedQty) || line.countedQty < 0)) {
        throw new StoreStocktakeError("INVALID_REQUEST");
      }
    }

    const addedLines = input.addedLines ?? [];
    const normalizedAdded = addedLines.map((al) => ({ ...al, variantSku: al.variantSku ?? "" }));
    const addedItemNameById = new Map<string, string>();

    if (normalizedAdded.length > 0) {
      /*
       * Every added itemId is user-supplied via the picker — unlike every other itemId reaching
       * this writer, which came from an existing StoreStock row — so it is checked against real
       * Item rows here, inside the transaction. relationMode = "prisma" means there is no
       * database FK to catch a dangling one, and the required Prisma relation would otherwise
       * write a line whose detail page throws "Inconsistent query result" forever.
       */
      for (const al of normalizedAdded) {
        if (al.countedQty !== null && (typeof al.countedQty !== "number" || !Number.isFinite(al.countedQty) || al.countedQty < 0)) {
          throw new StoreStocktakeError("INVALID_REQUEST");
        }
      }

      /*
       * DUPLICATE_LINE is caught here, ahead of the write, rather than relying solely on the
       * @@unique([stocktakeId, itemId, variantSku]) constraint — checking first keeps the P2002
       * catch below a fallback rather than the primary path, and catches a duplicate within the
       * same addedLines batch, which the constraint alone would only catch on the second insert.
       */
      const existingKeys = new Set(st.lines.map((l) => `${l.itemId}::${l.variantSku}`));
      const seenAddedKeys = new Set<string>();
      for (const al of normalizedAdded) {
        const key = `${al.itemId}::${al.variantSku}`;
        if (existingKeys.has(key) || seenAddedKeys.has(key)) throw new StoreStocktakeError("DUPLICATE_LINE");
        seenAddedKeys.add(key);
      }

      const addedItemIds = Array.from(new Set(normalizedAdded.map((al) => al.itemId)));
      const items = await tx.item.findMany({ where: { id: { in: addedItemIds } }, select: { id: true, nameId: true } });
      for (const item of items) addedItemNameById.set(item.id, item.nameId);
      for (const al of normalizedAdded) {
        if (!addedItemNameById.has(al.itemId)) throw new StoreStocktakeError("ITEM_NOT_FOUND");
      }

      /*
       * The reason check is deliberately NOT here. A save is a batch of counts from one sitting
       * (the PWA submits up to a whole store's worth of lines in one call) — aborting the entire
       * transaction over one added line missing a reason would discard every other line's count
       * with an error that names none of them. `approveStoreStocktake` already runs the identical
       * VARIANCE_NEEDS_REASON check over every line uniformly (added or not — an added line is
       * just a StoreStocktakeLine, and its `expectedQty` is seeded from live stock rather than
       * hardcoded), so deferring it there keeps the rule in one place and makes losing a batch at
       * save time impossible. ITEM_NOT_FOUND and DUPLICATE_LINE stay here because both are
       * structural — either would write a bad row.
       */
    }

    /* Compared at the column's own 2dp scale, so a resend of the same figure is never a change. */
    const toCents = (n: number | null) => (n === null ? null : Math.round(n * 100));
    const countChanged = (line: { lineId: string; countedQty: number | null }) => {
      const stored = storedLineById.get(line.lineId)!.countedQty;
      return toCents(line.countedQty) !== toCents(stored === null ? null : stored.toNumber());
    };
    const countsChanged = normalizedAdded.length > 0 || input.lines.some(countChanged);

    /*
     * Each line as it stands once this save is written: its count, the stamp it will carry, and —
     * for a counted line — the moment approval will re-apply movements from. A counted line with
     * no stamp of its own falls back to the document's, which this save is about to set to `now`
     * whenever it re-baselines, exactly as approval falls back.
     */
    const payloadByLineId = new Map(input.lines.map((l) => [l.lineId, l]));
    const existing = st.lines.map((l) => {
      const sent = payloadByLineId.get(l.id);
      const counted = sent ? sent.countedQty : (l.countedQty === null ? null : l.countedQty.toNumber());
      const stampChange = sent && countChanged(sent) ? { countFinishedAt: sent.countedQty === null ? null : momentOf(sent.countedAtMs) } : null;
      const stamp = stampChange ? stampChange.countFinishedAt : l.countFinishedAt;
      return { line: l, sent, counted, stampChange, moment: counted === null ? null : (stamp ?? now) };
    });
    const added = normalizedAdded.map((al, i) => ({
      key: `added:${i}`,
      al,
      stamp: al.countedQty === null ? null : momentOf(al.countedAtMs),
    }));

    /*
     * The re-baselined expected figure per line, in cents — only on a save that stamps the count.
     * One read of the store's whole StoreStock covers every line, added ones included, matched on
     * `stockMatchKey` — case-folded, as the unique index and `setStoreStock` match them.
     */
    const expectedCentsByKey = new Map<string, number>();
    if (countsChanged) {
      const liveRows = await tx.storeStock.findMany({
        where: { storeId: st.storeId },
        select: { itemId: true, variantSku: true, qty: true },
      });
      const liveCentsByStockKey = new Map(liveRows.map((s) => [stockMatchKey(s.itemId, s.variantSku), Math.round(s.qty.toNumber() * 100)]));

      const momentLines: CountMomentLine[] = [];
      for (const e of existing) {
        if (e.moment) momentLines.push({ key: e.line.id, itemId: e.line.itemId, variantSku: e.line.variantSku, moment: e.moment });
      }
      for (const a of added) {
        if (a.stamp) momentLines.push({ key: a.key, itemId: a.al.itemId, variantSku: a.al.variantSku, moment: a.stamp });
      }
      const sinceCentsByKey = await sumMovementsSinceCountCents(tx, st.storeId, momentLines);

      const rebaseline = (key: string, itemId: string, variantSku: string) =>
        expectedCentsByKey.set(key, (liveCentsByStockKey.get(stockMatchKey(itemId, variantSku)) ?? 0) - (sinceCentsByKey.get(key) ?? 0));
      for (const e of existing) rebaseline(e.line.id, e.line.itemId, e.line.variantSku);
      for (const a of added) rebaseline(a.key, a.al.itemId, a.al.variantSku);
    }

    const varianceOf = (counted: number | null, expectedCents: number) =>
      counted === null ? null : (Math.round(counted * 100) - expectedCents) / 100;

    for (const e of existing) {
      const storedExpectedCents = Math.round(e.line.expectedQty.toNumber() * 100);
      const rebased = expectedCentsByKey.get(e.line.id);
      const expectedCents = rebased ?? storedExpectedCents;

      if (e.sent) {
        await tx.storeStocktakeLine.update({
          where: { id: e.line.id },
          data: {
            countedQty: e.counted,
            varianceQty: varianceOf(e.counted, expectedCents),
            cause: e.sent.cause ?? null,
            reason: e.sent.reason ?? null,
            ...(rebased !== undefined ? { expectedQty: rebased / 100 } : {}),
            ...(e.stampChange ?? {}),
          },
        });
      } else if (rebased !== undefined && rebased !== storedExpectedCents) {
        /* A line this save was not sent keeps its count, cause and reason; only its baseline moves. */
        await tx.storeStocktakeLine.update({
          where: { id: e.line.id },
          data: { expectedQty: rebased / 100, varianceQty: varianceOf(e.counted, rebased) },
        });
      }
    }

    for (const a of added) {
      const expectedCents = expectedCentsByKey.get(a.key) ?? 0;
      try {
        await tx.storeStocktakeLine.create({
          data: {
            stocktakeId: st.id,
            itemId: a.al.itemId,
            variantSku: a.al.variantSku,
            productName: addedItemNameById.get(a.al.itemId)!,
            expectedQty: expectedCents / 100,
            countedQty: a.al.countedQty,
            varianceQty: varianceOf(a.al.countedQty, expectedCents),
            soldInPeriodQty: 0,
            cause: a.al.cause ?? null,
            reason: a.al.reason ?? null,
            isAdded: true,
            countFinishedAt: a.stamp,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new StoreStocktakeError("DUPLICATE_LINE");
        }
        throw e;
      }
    }

    let status = st.status;
    if (input.submit || countsChanged) {
      if (input.submit) status = "PENDING_VERIFICATION";
      await tx.storeStocktake.update({
        where: { id: st.id },
        data: {
          ...(input.submit ? { status: "PENDING_VERIFICATION" as const, submittedAt: now, submittedById: input.userId } : {}),
          ...(countsChanged ? { countFinishedAt: now } : {}),
        },
      });
    }

    return { ok: true as const, status };
  });
}

/**
 * Approves a count. Every guard below runs before any write. The count is the truth at the moment
 * it was taken — that is the whole premise of this document — so every counted line SETs
 * `StoreStock.qty` to its counted figure PLUS every store ledger movement for that item::variant
 * recorded after THAT LINE's count moment: a POS sale or a konsi delivery while the count waited
 * for an admin happened after the shelf was counted, and setting the bare counted figure would
 * erase it. A line's moment is its own `countFinishedAt` — when its figure last changed — falling
 * back to the document's `countFinishedAt` for a line saved before the line column existed, so an
 * admin correcting one line never moves the moment of the others. A retur raised before a line's
 * moment, and a store-to-store transfer whose goods moved before it, are excluded for that line —
 * the count already saw their goods gone or arrived, even though their ledger rows land later
 * (`sumMovementsSinceCountCents` holds every one of those rules).
 *
 * A transfer whose goods moved on or before the DOCUMENT's count moment, which is still PENDING
 * and moves an item::variant this count counted, refuses the approval instead
 * (`TRANSFER_PENDING`), because once this count is approved the transfer can never be approved.
 * That refusal deliberately keeps the document moment rather than any line's: it must agree with
 * `approveStoreTransfer`'s `COUNTED_SINCE_MOVE`, which reads the document stamp. It still runs for
 * a count whose `countFinishedAt` is null — falling back to this approval's own instant, the same
 * fallback `COUNTED_SINCE_MOVE` uses — so a legacy count can never approve first and strand a
 * transfer behind that guard forever.
 *
 * A field retur raised on or before the DOCUMENT's count moment, still open, with a line on a
 * counted item::variant at a KONSI store refuses the same way (`RETUR_PENDING`, the same moment
 * as `TRANSFER_PENDING`): its store row has not landed yet, and once it does after this approval
 * it would take the counted-out units off again.
 *
 * The ledger entry `setStoreStock` writes is then the true shrinkage or surplus at the count
 * moment, whatever moved since. A counted line with no moment at all — neither its own nor the
 * document's, a count saved before either column existed — keeps the old behaviour: the bare
 * counted figure, with no re-application and so no exclusion. Nothing here refuses on an
 * unbalanced count: a store may legitimately end approval still holding negative rows — a
 * post-count sale can take a line below zero too — and that is recorded and surfaced, never
 * blocked.
 *
 * `varianceQty` is recomputed here, never trusted from whatever `saveStocktakeCounts` last wrote:
 * it is the delta this approval books — the target above minus the live qty it replaces — and the
 * `VARIANCE_NEEDS_REASON`/`SHORTFALL_NEEDS_CAUSE` checks gate on that same figure. The save
 * measures `countedQty − expectedQty` against a baseline of live stock minus the same post-count
 * movements, and a movement after that save cancels out of both (it is in live stock and in the
 * re-applied movements alike), so until a late row lands the two are equal. They part only when a
 * row the count already saw lands after the save — a retur raised before the count and settled
 * later, a transfer moved before it and approved later, which is every counted line of that
 * transfer once a `TRANSFER_PENDING` refusal is cleared by approving it — and then the booked
 * delta is the truth: the stored figure would demand a cause for a shortfall that books nothing,
 * and no cause-only resave could clear it. A line with no moment books `counted − live`.
 */
export async function approveStoreStocktake(input: {
  stocktakeId: string;
  approvedById: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const st = await tx.storeStocktake.findUnique({
      where: { id: input.stocktakeId },
      select: {
        id: true,
        docNo: true,
        storeId: true,
        status: true,
        countFinishedAt: true,
        lines: {
          select: {
            id: true,
            itemId: true,
            variantSku: true,
            countedQty: true,
            cause: true,
            reason: true,
            countFinishedAt: true,
          },
        },
      },
    });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    /*
     * Computed once, up front, so every use of "now" inside this approval — the fallback count
     * moment the TRANSFER_PENDING and RETUR_PENDING refusals below share, and the `approvedAt`
     * stamp at the end — is the exact same instant rather than two separate `new Date()` calls that
     * could straddle a millisecond.
     */
    const approvedAt = new Date();

    const counts = st.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      variantSku: l.variantSku,
      counted: l.countedQty === null ? null : l.countedQty.toNumber(),
      cause: l.cause,
      reason: l.reason,
      lineCountFinishedAt: l.countFinishedAt,
    }));

    /*
     * What each counted line will book, read before any guard: the target it SETs (counted plus
     * what moved since its moment; a line with no moment at all re-applies nothing, the old
     * SET-the-counted-figure behaviour), the live qty that SET replaces, and the difference —
     * exactly the ledger row `setStoreStock` writes. That booked delta, not the stored
     * `counted − expected`, is the variance the cause and reason checks below gate on and the
     * `varianceQty` stored: a row the count already saw that landed after the last save (a retur
     * raised before the count and settled later, a transfer moved before it and approved later, an
     * offline konsi delivery that synced later) is still in the stored `expectedQty` but skipped
     * here, so the stored figure can ask for an explanation of a shortfall that books nothing, or
     * miss one that books a real loss. Until such a row lands the two are equal.
     */
    const bookedByLineId = await bookedCountCents(
      tx,
      st.storeId,
      st.countFinishedAt,
      counts.flatMap((l) => (l.counted === null ? [] : [{ key: l.id, itemId: l.itemId, variantSku: l.variantSku, countedQty: l.counted, lineCountFinishedAt: l.lineCountFinishedAt }])),
    );
    const computed = counts.map((l) => {
      const booked = bookedByLineId.get(l.id);
      if (l.counted === null || !booked) return { ...l, variance: null, target: null, liveQty: null };
      return { ...l, variance: (booked.targetCents - booked.liveCents) / 100, target: booked.targetCents / 100, liveQty: booked.liveCents / 100 };
    });

    for (const l of computed) {
      if (l.variance !== null && l.variance !== 0 && !(l.reason && l.reason.trim())) {
        throw new StoreStocktakeError("VARIANCE_NEEDS_REASON");
      }
      if (l.variance !== null && l.variance < 0 && !l.cause) {
        throw new StoreStocktakeError("SHORTFALL_NEEDS_CAUSE");
      }
    }

    /*
     * relationMode = "prisma" means there is no database FK backing StoreStocktakeLine.item even
     * though the Prisma relation is required — a dangling itemId writes a row whose detail page
     * throws "Inconsistent query result" forever, with no UI repair path. Checked for every line
     * on the document, not just counted ones, since an uncounted line's itemId is just as
     * required by that relation.
     */
    const itemIds = Array.from(new Set(st.lines.map((l) => l.itemId)));
    const existingItems = itemIds.length > 0 ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true } }) : [];
    const existingItemIds = new Set(existingItems.map((i) => i.id));
    for (const id of itemIds) {
      if (!existingItemIds.has(id)) throw new StoreStocktakeError("ITEM_NOT_FOUND");
    }

    /*
     * A store-to-store transfer touching this store — from it or to it — whose goods moved on or
     * before the count, which moves an item::variant this count counted, and which is still
     * PENDING: the count holds a move StoreStock has not recorded, and once this count is approved
     * the transfer is refused `COUNTED_SINCE_MOVE` forever. Refused here, naming the transfers, so
     * the admin approves or cancels them first. A transfer of keys this count left uncounted or
     * never had cannot be in the count, so it does not refuse. The count moment here is the
     * DOCUMENT's `countFinishedAt`, never a line's own: `approveStoreTransfer`'s
     * `COUNTED_SINCE_MOVE` reads the document stamp, and the two guards must agree on the same
     * instant for the same document or a transfer could pass one and be stranded by the other. For
     * a count saved before that column existed it is `approvedAt` above (the same instant this
     * approval stamps on the document below, not a second `new Date()`), matching the fallback
     * `COUNTED_SINCE_MOVE` uses for a null-`countFinishedAt` count; without it a legacy count could
     * approve first and strand the transfer behind `COUNTED_SINCE_MOVE` forever, unable to ever
     * approve. This fallback governs the refusal only — a counted line with no moment of its own
     * or the document's still re-applies nothing above. Both variantSku columns are non-nullable,
     * so the keys match exactly.
     */
    const countedKeys = computed
      .filter((l) => l.counted !== null)
      .map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "" }));
    const countMoment = st.countFinishedAt ?? approvedAt;
    if (countedKeys.length > 0) {
      const pendingTransfers = await tx.storeTransfer.findMany({
        where: {
          status: "PENDING",
          movedAt: { lte: countMoment },
          OR: [{ fromStoreId: st.storeId }, { toStoreId: st.storeId }],
          lines: { some: { OR: countedKeys } },
        },
        orderBy: { docNo: "asc" },
        select: { docNo: true },
      });
      if (pendingTransfers.length > 0) {
        throw new StoreStocktakeError("TRANSFER_PENDING", pendingTransfers.map((t) => t.docNo).join(", "));
      }
    }

    /**
     * A field retur of this store raised on or before the count moment (the same `countMoment` as
     * above) that is still open — awaiting receipt, mismatch resolution or approval — and has a line
     * on an item::variant this count COUNTED refuses `RETUR_PENDING`, naming the returs in `detail`.
     * The retur's goods left the shelf when it was raised, so the count already saw them gone, but
     * its store row has not landed yet: counted 7 where StoreStock holds 10, 3 of them on a retur
     * raised before the count — approval SETs 7, and when the retur later settles its row takes 3
     * more, leaving 4. The post-count exclusion below only skips a retur row that already exists at
     * approval, so it cannot catch one that lands afterwards. Refusing until the retur is received
     * and approved (or cancelled, if it was never sent) keeps that row on the excluded side.
     *
     * KONSI-only: both retur writers touch `StoreStock` only at a KONSI store, so at any other store
     * there is no later row to double-count. An APPROVED retur does not refuse — its row has already
     * landed, ahead of this SET rather than after it, and the exclusion skips it when it is
     * post-count — and a CANCELLED one moved no stock. Returs of keys this count left uncounted or
     * never had cannot be in the count, so they do not refuse. Both variantSku columns are
     * non-nullable, so the keys match exactly.
     */
    if (countedKeys.length > 0) {
      const store = await tx.store.findUnique({ where: { id: st.storeId }, select: { termsType: true } });
      if (store?.termsType === "KONSI") {
        const pendingReturs = await tx.fieldReturn.findMany({
          where: {
            storeId: st.storeId,
            createdAt: { lte: countMoment },
            status: { in: ["PENDING_WAREHOUSE_RECEIVING", "MISMATCH_PENDING_RESOLUTION", "PENDING_APPROVAL"] },
            lines: { some: { OR: countedKeys } },
          },
          orderBy: { docNo: "asc" },
          select: { docNo: true },
        });
        if (pendingReturs.length > 0) {
          throw new StoreStocktakeError("RETUR_PENDING", pendingReturs.map((r) => r.docNo).join(", "));
        }
      }
    }

    let isFullCount = st.lines.length > 0;

    for (const l of computed) {
      if (l.target === null) {
        isFullCount = false;
        continue;
      }
      const target = l.target;

      /*
       * avgCost is NEVER touched — not on update, and 0 on a created row. Both existing
       * store-side decrement paths leave it alone, and a count carries no cost information to
       * invent one from. See the sibling comment in the design doc for the full rationale.
       *
       * setStoreStock (not the delta mover): the count is the truth at the count moment, so the
       * target — counted plus what moved since — is written as an absolute figure, not a delta off
       * whatever the live row happened to hold. A line whose target matches the live qty writes no
       * ledger entry — nothing was lost or found.
       */
      await setStoreStock(tx, {
        storeId: st.storeId,
        itemId: l.itemId,
        variantSku: l.variantSku,
        nextQty: target,
        refType: "StoreStocktake" satisfies StockLedgerRefType,
        refId: st.id,
        refDocNumber: st.docNo,
        createdById: input.approvedById,
      });

      await tx.storeStocktakeLine.update({
        where: { id: l.id },
        data: {
          varianceQty: l.variance,
          qtyAtApproval: l.liveQty,
          appliedQty: target,
        },
      });
    }

    await tx.storeStocktake.update({
      where: { id: st.id },
      data: {
        status: "APPROVED",
        approvedAt,
        approvedById: input.approvedById,
        openKey: null,
        isFullCount,
      },
    });

    return { ok: true as const };
  });
}

/**
 * Abandons an open document. Requires a non-empty reason and nulls `openKey` — skipping that
 * would leave the store permanently unable to open a new count, since `openKey` is the unique
 * constraint that enforces "one open stocktake per store".
 */
export async function cancelStoreStocktake(input: {
  stocktakeId: string;
  cancelledById: string;
  reason: string;
}): Promise<{ ok: true }> {
  if (!input.reason || !input.reason.trim()) throw new StoreStocktakeError("INVALID_REQUEST");

  return runSerializable(async (tx) => {
    const st = await tx.storeStocktake.findUnique({ where: { id: input.stocktakeId }, select: { id: true, status: true } });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    await tx.storeStocktake.update({
      where: { id: st.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: input.cancelledById,
        cancelReason: input.reason,
        openKey: null,
      },
    });

    return { ok: true as const };
  });
}
