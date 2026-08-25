import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { buildStocktakeLines, previousApprovedCountedAt } from "./queries";
import { StoreStocktakeError } from "./errors";

type CauseValue = "SHRINKAGE" | "UNRECORDED_SALE";

type AddedLineInput = {
  itemId: string;
  variantSku: string;
  countedQty: number | null;
  cause?: CauseValue | null;
  reason?: string | null;
};

/**
 * Opens a new count for a store. Refused with `ALREADY_OPEN` when the store already has a
 * document whose `openKey` is non-null — the explicit check exists only to return a readable
 * code; the real guard is the `@unique` constraint on `openKey` itself, which is what actually
 * enforces one open stocktake per store under concurrent creation.
 *
 * `periodFrom` falls out of the store's previous APPROVED count rather than being supplied by
 * the caller, so the sold-in-window figures on the lines below are never a caller-chosen range.
 */
export async function createStoreStocktake(input: {
  storeId: string;
  createdById: string;
  countedAt: Date;
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

    const created = await tx.storeStocktake.create({
      data: {
        docNo,
        storeId: input.storeId,
        openKey: input.storeId,
        countedAt: input.countedAt,
        periodFrom,
        createdById: input.createdById,
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
  });
}

/**
 * Writes counts onto an already-open document. Never touches `StoreStock` — a save is a claim,
 * not yet the truth; only `approveStoreStocktake` writes the ledger. `varianceQty` is
 * recomputed here too (same `counted − expected` formula `approveStoreStocktake` uses) purely so
 * the detail page can show a live variance before approval — approval does not trust this value
 * and recomputes it independently from whatever is on the line at that moment.
 *
 * `addedLines` is the add-item picker's path: a line for an item the store's ledger has no
 * `StoreStock` row for. Each lands with `isAdded: true`, `expectedQty: 0` (nothing was expected —
 * there was no shelf row), and `productName` resolved from `Item` the same way
 * `buildStocktakeLines` fills it. Its variance is therefore just the count itself
 * (`countedQty − 0`), which is always zero or a surplus, never a shortfall — so an added line
 * needs a reason on any non-zero count but never a cause; `SHORTFALL_NEEDS_CAUSE` cannot fire on
 * this path by construction.
 */
export async function saveStocktakeCounts(input: {
  stocktakeId: string;
  lines: Array<{ lineId: string; countedQty: number | null; cause?: CauseValue | null; reason?: string | null }>;
  addedLines?: AddedLineInput[];
  submit: boolean;
  userId: string;
}): Promise<{ ok: true; status: string }> {
  return runSerializable(async (tx) => {
    const st = await tx.storeStocktake.findUnique({
      where: { id: input.stocktakeId },
      select: { id: true, status: true, lines: { select: { id: true, itemId: true, variantSku: true, expectedQty: true } } },
    });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    const expectedByLineId = new Map(st.lines.map((l) => [l.id, l.expectedQty.toNumber()]));

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

      for (const al of normalizedAdded) {
        const variance = al.countedQty === null ? null : al.countedQty - 0;
        if (variance !== null && variance !== 0 && !(al.reason && al.reason.trim())) {
          throw new StoreStocktakeError("VARIANCE_NEEDS_REASON");
        }
      }
    }

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
        },
      });
    }

    for (const al of normalizedAdded) {
      const variance = al.countedQty === null ? null : al.countedQty - 0;
      try {
        await tx.storeStocktakeLine.create({
          data: {
            stocktakeId: st.id,
            itemId: al.itemId,
            variantSku: al.variantSku,
            productName: addedItemNameById.get(al.itemId)!,
            expectedQty: 0,
            countedQty: al.countedQty,
            varianceQty: variance,
            soldInPeriodQty: 0,
            cause: al.cause ?? null,
            reason: al.reason ?? null,
            isAdded: true,
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
    if (input.submit) {
      status = "PENDING_VERIFICATION";
      await tx.storeStocktake.update({
        where: { id: st.id },
        data: { status: "PENDING_VERIFICATION", submittedAt: new Date(), submittedById: input.userId },
      });
    }

    return { ok: true as const, status };
  });
}

/**
 * Approves a count. Every guard below runs before any write. The count is the truth — that is
 * the whole premise of this document — so `StoreStock.qty` is written to the counted figure for
 * every line that carries one, even a live row that has drifted since the snapshot. Nothing here
 * refuses on an unbalanced count: a store may legitimately end approval still holding negative
 * rows, and that is recorded and surfaced, never blocked.
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
        storeId: true,
        status: true,
        lines: {
          select: { id: true, itemId: true, variantSku: true, expectedQty: true, countedQty: true, cause: true, reason: true },
        },
      },
    });
    if (!st) throw new StoreStocktakeError("NOT_FOUND");
    if (st.status !== "DRAFT" && st.status !== "PENDING_VERIFICATION") throw new StoreStocktakeError("INVALID_STATE");

    const computed = st.lines.map((l) => {
      const expected = l.expectedQty.toNumber();
      const counted = l.countedQty === null ? null : l.countedQty.toNumber();
      const variance = counted === null ? null : counted - expected;
      return { id: l.id, itemId: l.itemId, variantSku: l.variantSku, counted, variance, cause: l.cause, reason: l.reason };
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

    let isFullCount = st.lines.length > 0;

    for (const l of computed) {
      if (l.counted === null) {
        isFullCount = false;
        continue;
      }

      const key = { storeId_itemId_variantSku: { storeId: st.storeId, itemId: l.itemId, variantSku: l.variantSku ?? "" } };
      const live = await tx.storeStock.findUnique({ where: key, select: { qty: true } });

      /*
       * avgCost is NEVER touched — not on update, and 0 on a created row. Both existing
       * store-side decrement paths leave it alone, and a count carries no cost information to
       * invent one from. See the sibling comment in the design doc for the full rationale.
       */
      await tx.storeStock.upsert({
        where: key,
        create: { storeId: st.storeId, itemId: l.itemId, variantSku: l.variantSku ?? "", qty: l.counted, avgCost: 0 },
        update: { qty: l.counted },
      });

      await tx.storeStocktakeLine.update({
        where: { id: l.id },
        data: {
          varianceQty: l.variance,
          qtyAtApproval: live ? live.qty.toNumber() : 0,
          appliedQty: l.counted,
        },
      });
    }

    await tx.storeStocktake.update({
      where: { id: st.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
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
