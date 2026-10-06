import { Prisma, setStoreStock } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { buildStocktakeLines, previousApprovedCountedAt } from "./queries";
import { StoreStocktakeError } from "./errors";
import { resolveLineCountMoment } from "./count-moment";

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
 * recomputed here too (same `counted − expected` formula `approveStoreStocktake` uses) purely so
 * the detail page can show a live variance before approval — approval does not trust this value
 * and recomputes it independently from whatever is on the line at that moment.
 *
 * `addedLines` is the add-item picker's path: a line for an item that was not on the document's
 * own snapshot. `expectedQty` is seeded from the store's LIVE `StoreStock` row for that
 * `itemId::variantSku`, looked up inside this same transaction — falling back to `0` only when no
 * such row exists at all. The snapshot and "live" can genuinely diverge (a konsi transfer landing
 * between the document opening and this save), and the SPG's own screen renders from live stock,
 * so a pair that lands here as "added" may still have real expected stock; seeding `0` in that
 * case would misreport a shortfall as a surplus. `productName` is resolved from `Item` the same
 * way `buildStocktakeLines` fills it. Its variance is `countedQty − expectedQty`, computed with
 * the now-correct `expectedQty`, so `approveStoreStocktake`'s `SHORTFALL_NEEDS_CAUSE` check can
 * fire on an added line exactly as it would have had the line existed on the original snapshot.
 * The reason check is NOT enforced here at save time — see the comment at the added-lines block
 * below for why — only the structural guards (`ITEM_NOT_FOUND`, `DUPLICATE_LINE`) are.
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
        lines: { select: { id: true, itemId: true, variantSku: true, expectedQty: true, countedQty: true } },
      },
    });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    /*
     * A device-reported count moment is never allowed before the store's previous approval: that
     * approval SET the balance, so a moment before it would have this count re-apply movements the
     * previous count already absorbed (approval also skips earlier counts' own ledger rows — see
     * `approveStoreStocktake`). Anything the device sent that cannot be used falls back to the
     * server instant, which is exactly what a line got before device times were sent at all.
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

    const expectedByLineId = new Map(st.lines.map((l) => [l.id, l.expectedQty.toNumber()]));
    const storedCountByLineId = new Map(st.lines.map((l) => [l.id, l.countedQty === null ? null : l.countedQty.toNumber()]));

    /*
     * Every line id must already belong to this document, and every countedQty must be a
     * non-negative finite number (or null). Both are shape checks on a payload nothing else
     * validates before it reaches here, so a bad one is INVALID_REQUEST, never a domain code
     * that would misdescribe a malformed request as a legitimate refusal.
     */
    for (const line of input.lines) {
      if (!expectedByLineId.has(line.lineId)) throw new StoreStocktakeError("INVALID_REQUEST");
      if (line.countedQty !== null && (typeof line.countedQty !== "number" || !Number.isFinite(line.countedQty) || line.countedQty < 0)) {
        throw new StoreStocktakeError("INVALID_REQUEST");
      }
    }

    const addedLines = input.addedLines ?? [];
    const normalizedAdded = addedLines.map((al) => ({ ...al, variantSku: al.variantSku ?? "" }));
    const addedItemNameById = new Map<string, string>();
    const liveQtyByAddedKey = new Map<string, number>();

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
       * Live StoreStock for these items, batched — the snapshot the document opened with may
       * already be stale by the time an added line is saved (a konsi transfer landing after
       * `createStoreStocktake` ran), so `expectedQty` below comes from the CURRENT row, never a
       * hardcoded 0. `0` is only the fallback for an item::variant the store has genuinely never
       * held stock for.
       */
      const liveAddedStock = await tx.storeStock.findMany({
        where: { storeId: st.storeId, itemId: { in: addedItemIds } },
        select: { itemId: true, variantSku: true, qty: true },
      });
      for (const s of liveAddedStock) liveQtyByAddedKey.set(`${s.itemId}::${s.variantSku}`, s.qty.toNumber());

      /*
       * The reason check is deliberately NOT here. A save is a batch of counts from one sitting
       * (the PWA submits up to a whole store's worth of lines in one call) — aborting the entire
       * transaction over one added line missing a reason would discard every other line's count
       * with an error that names none of them. `approveStoreStocktake` already runs the identical
       * VARIANCE_NEEDS_REASON check over every line uniformly (added or not — an added line is
       * just a StoreStocktakeLine, and its `expectedQty` is now seeded from live stock rather than
       * hardcoded), so deferring it there keeps the rule in one place and makes losing a batch at
       * save time impossible. ITEM_NOT_FOUND and DUPLICATE_LINE stay here because both are
       * structural — either would write a bad row.
       */
    }

    /* Compared at the column's own 2dp scale, so a resend of the same figure is never a change. */
    const toCents = (n: number | null) => (n === null ? null : Math.round(n * 100));
    const countChanged = (line: { lineId: string; countedQty: number | null }) =>
      toCents(line.countedQty) !== toCents(storedCountByLineId.get(line.lineId) ?? null);

    for (const line of input.lines) {
      const expected = expectedByLineId.get(line.lineId)!;
      const variance = line.countedQty === null ? null : line.countedQty - expected;
      await tx.storeStocktakeLine.update({
        where: { id: line.lineId },
        data: {
          countedQty: line.countedQty,
          varianceQty: variance,
          cause: line.cause ?? null,
          reason: line.reason ?? null,
          ...(countChanged(line) ? { countFinishedAt: line.countedQty === null ? null : momentOf(line.countedAtMs) } : {}),
        },
      });
    }

    for (const al of normalizedAdded) {
      const expected = liveQtyByAddedKey.get(`${al.itemId}::${al.variantSku}`) ?? 0;
      const variance = al.countedQty === null ? null : al.countedQty - expected;
      try {
        await tx.storeStocktakeLine.create({
          data: {
            stocktakeId: st.id,
            itemId: al.itemId,
            variantSku: al.variantSku,
            productName: addedItemNameById.get(al.itemId)!,
            expectedQty: expected,
            countedQty: al.countedQty,
            varianceQty: variance,
            soldInPeriodQty: 0,
            cause: al.cause ?? null,
            reason: al.reason ?? null,
            isAdded: true,
            countFinishedAt: al.countedQty === null ? null : momentOf(al.countedAtMs),
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new StoreStocktakeError("DUPLICATE_LINE");
        }
        throw e;
      }
    }

    const countsChanged = normalizedAdded.length > 0 || input.lines.some(countChanged);

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
 * the count already saw their goods gone or arrived, even though their ledger rows land later (see
 * the post-count block below).
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
 * The ledger entry `setStoreStock` writes is then the true shrinkage or surplus at the count
 * moment, whatever moved since. A counted line with no moment at all — neither its own nor the
 * document's, a count saved before either column existed — keeps the old behaviour: the bare
 * counted figure, with no re-application and so no exclusion. Nothing here refuses on an
 * unbalanced count: a store may legitimately end approval still holding negative rows — a
 * post-count sale can take a line below zero too — and that is recorded and surfaced, never
 * blocked.
 *
 * `varianceQty` is (re)computed here from the line's own `countedQty`/`expectedQty` rather than
 * trusted from whatever `saveStocktakeCounts` last wrote — the two computations use the exact
 * same formula, so this is not a second derivation, just the one place that is authoritative at
 * approval time regardless of how the line got its count.
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
            expectedQty: true,
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
     * Computed once, up front, so every use of "now" inside this approval — the TRANSFER_PENDING
     * fallback count moment below and the `approvedAt` stamp at the end — is the exact same
     * instant rather than two separate `new Date()` calls that could straddle a millisecond.
     */
    const approvedAt = new Date();

    const computed = st.lines.map((l) => {
      const expected = l.expectedQty.toNumber();
      const counted = l.countedQty === null ? null : l.countedQty.toNumber();
      const variance = counted === null ? null : counted - expected;
      const moment = counted === null ? null : (l.countFinishedAt ?? st.countFinishedAt);
      return { id: l.id, itemId: l.itemId, variantSku: l.variantSku, counted, variance, cause: l.cause, reason: l.reason, moment };
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
     * or the document's still re-applies nothing below. Both variantSku columns are non-nullable,
     * so the keys match exactly.
     */
    const countedKeys = computed
      .filter((l) => l.counted !== null)
      .map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "" }));
    if (countedKeys.length > 0) {
      const countMoment = st.countFinishedAt ?? approvedAt;
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
     * Every store movement recorded after each counted line's own moment, summed per line in
     * cents. One read covers every line: the ledger rows after the EARLIEST line moment, then each
     * line keeps only its own item::variant's rows stamped strictly after its own moment. Only one
     * stocktake per store can be open (`openKey`), so none of these rows is another count's. A line
     * with no moment re-applies nothing, which is exactly the old SET-the-counted-figure behaviour.
     *
     * Excluded per line: a retur's store row whose retur was RAISED on or before that line's
     * moment. A retur's ledger row lags the physical movement — the goods leave the shelf when it
     * is raised, but its store row lands later, at approve for a FIELD retur, at receipt plus an
     * approve-time delta for an ADMIN one — so a shelf counted after the raise already saw those
     * units gone, and re-applying the row would take them off twice. Both retur writers stamp the
     * FieldReturn id as the row's `refId`. A retur raised after the line was counted still counts:
     * its goods left after the shelf was counted. Excluded the same way: a store-to-store
     * transfer's rows — BOTH legs, the source's −q and the destination's +q — whose transfer's
     * `movedAt` is on or before the line's moment. Stock moves at transfer approve, which can land
     * after the goods physically moved, so a shelf counted in between already saw them gone or
     * arrived. Both legs stamp the StoreTransfer id as `refId`. A transfer whose goods moved after
     * the line was counted is still re-applied. Both exclusions are judged against each line's own
     * moment, so one retur or transfer can be excluded for a line counted after it and re-applied
     * for a line counted before it. Only a counted line reads these sums at all, so a row for an
     * uncounted item never reaches a target either way.
     *
     * Never re-applied: an earlier count's own `StoreStocktake` rows. That approval SET the
     * balance to what its own count saw, so it is never a movement this count's shelf missed. A
     * line moment can sit at or before such a row only when it came from the SPG sheet's device
     * time, which `saveStocktakeCounts` clamps to the previous approval's `approvedAt` — and that
     * approval writes its rows at or a few milliseconds after the `approvedAt` it stamps.
     */
    const postCountCentsByLineId = new Map<string, number>();
    const momentLines = computed.filter((l) => l.counted !== null && l.moment !== null);
    if (momentLines.length > 0) {
      const earliest = new Date(momentLines.reduce((min, l) => Math.min(min, l.moment!.getTime()), Infinity));
      const postCount = await tx.stockLedgerEntry.findMany({
        where: { locationType: "STORE", locationId: st.storeId, createdAt: { gt: earliest } },
        select: { itemId: true, variantSku: true, qty: true, refType: true, refId: true, createdAt: true },
      });
      const returIds = Array.from(new Set(postCount.filter((r) => r.refType === "FieldReturn").map((r) => r.refId)));
      const returs = returIds.length > 0
        ? await tx.fieldReturn.findMany({ where: { id: { in: returIds } }, select: { id: true, createdAt: true } })
        : [];
      const returRaisedAtMs = new Map(returs.map((r) => [r.id, r.createdAt.getTime()]));
      const transferIds = Array.from(new Set(postCount.filter((r) => r.refType === "StoreTransfer").map((r) => r.refId)));
      const transfers = transferIds.length > 0
        ? await tx.storeTransfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, movedAt: true } })
        : [];
      const transferMovedAtMs = new Map(transfers.map((t) => [t.id, t.movedAt.getTime()]));

      const rowsByKey = new Map<string, typeof postCount>();
      for (const r of postCount) {
        const key = `${r.itemId}::${r.variantSku}`;
        const rows = rowsByKey.get(key);
        if (rows) rows.push(r);
        else rowsByKey.set(key, [r]);
      }

      for (const l of momentLines) {
        const momentMs = l.moment!.getTime();
        let cents = 0;
        for (const r of rowsByKey.get(`${l.itemId}::${l.variantSku ?? ""}`) ?? []) {
          if (r.createdAt.getTime() <= momentMs) continue;
          if (r.refType === "StoreStocktake") continue;
          if (r.refType === "FieldReturn" && (returRaisedAtMs.get(r.refId) ?? Infinity) <= momentMs) continue;
          if (r.refType === "StoreTransfer" && (transferMovedAtMs.get(r.refId) ?? Infinity) <= momentMs) continue;
          cents += Math.round(r.qty.toNumber() * 100);
        }
        postCountCentsByLineId.set(l.id, cents);
      }
    }

    let isFullCount = st.lines.length > 0;

    for (const l of computed) {
      if (l.counted === null) {
        isFullCount = false;
        continue;
      }

      const key = { storeId_itemId_variantSku: { storeId: st.storeId, itemId: l.itemId, variantSku: l.variantSku ?? "" } };
      const live = await tx.storeStock.findUnique({ where: key, select: { qty: true } });
      const postCountCents = postCountCentsByLineId.get(l.id) ?? 0;
      const target = (Math.round(l.counted * 100) + postCountCents) / 100;

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
          qtyAtApproval: live ? live.qty.toNumber() : 0,
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
