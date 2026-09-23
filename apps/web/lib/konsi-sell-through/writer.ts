import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import {
  applyResolution,
  deriveSellThroughLines,
  InvalidResolutionError,
  isLineHeld,
  roundQty,
  UnknownLedgerRefTypeError,
  type DerivedLine,
  type SellThroughResolutionValue,
} from "./derive";
import { loadSellThroughInputs, stocktakeBoundary } from "./window";
import { SellThroughError } from "./errors";

/* A UX bound on a free-text reason — the column itself is TEXT. */
const REASON_MAX_LENGTH = 1000;

const RESOLUTIONS: readonly SellThroughResolutionValue[] = ["BILL", "SHRINKAGE", "BILL_POS", "REDUCE"];

/* The ledger-derived figures approve re-derives and compares; everything else on a line is a snapshot or an admin decision. */
const DERIVED_FIGURES = ["openingQty", "inQty", "outQty", "posSoldQty", "gapQty", "closingQty"] as const;

const lineKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

function derive(input: Parameters<typeof deriveSellThroughLines>[0]): DerivedLine[] {
  try {
    return deriveSellThroughLines(input);
  } catch (e) {
    if (e instanceof UnknownLedgerRefTypeError) throw new SellThroughError("UNKNOWN_REF_TYPE", e.refType);
    throw e;
  }
}

/**
 * The mariadb adapter reports a unique violation's constraint as the INDEX NAME
 * (`KonsiSellThrough_chainKey_key`) rather than the column, and where it lands in `meta` varies,
 * so the column name is searched for across the message and the whole meta blob.
 */
function isUniqueViolationOn(e: unknown, column: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  return `${e.message} ${JSON.stringify(e.meta ?? {})}`.includes(column);
}

/**
 * Creates a DRAFT report from an approved FULL store stocktake of a KONSI store. The store is
 * derived from the stocktake itself, never from the caller, and ownership/approval/full-count are
 * all checked before `stocktakeBoundary` runs, because that helper trusts its inputs.
 *
 * `stocktakeKey` and `chainKey` are the live uniqueness keys: one live report per closing count,
 * and one live child per (store, previous report) — which is what makes "at most one DRAFT per
 * store" structural under concurrent creation. Both explicit checks exist only to return a
 * readable code; a racing insert that slips past them is mapped from its P2002 to the same code.
 */
export async function createSellThrough(input: {
  closingStocktakeId: string;
  createdById: string;
}): Promise<{ id: string; docNo: string }> {
  return runSerializable(async (tx) => {
    const stocktake = await tx.storeStocktake.findUnique({
      where: { id: input.closingStocktakeId },
      select: {
        id: true,
        storeId: true,
        status: true,
        isFullCount: true,
        lines: { select: { itemId: true, variantSku: true, productName: true } },
      },
    });
    if (!stocktake) throw new SellThroughError("NOT_FOUND", "STOCKTAKE");
    if (stocktake.status !== "APPROVED") throw new SellThroughError("STOCKTAKE_NOT_APPROVED");
    if (!stocktake.isFullCount) throw new SellThroughError("NOT_FULL_COUNT");

    const storeId = stocktake.storeId;
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { termsType: true, sellThroughMethod: true } });
    if (!store) throw new SellThroughError("NOT_FOUND", "STORE");
    if (store.termsType !== "KONSI") throw new SellThroughError("NOT_KONSI");
    if (!store.sellThroughMethod) throw new SellThroughError("METHOD_NOT_SET");
    const method = store.sellThroughMethod;

    const used = await tx.konsiSellThrough.findUnique({ where: { stocktakeKey: stocktake.id }, select: { id: true } });
    if (used) throw new SellThroughError("ALREADY_USED");

    const previous = await tx.konsiSellThrough.findFirst({
      where: { storeId, status: "APPROVED" },
      orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
      select: { id: true, closingStocktakeId: true },
    });
    if (previous) {
      const closingBoundary = await stocktakeBoundary(tx, storeId, stocktake.id);
      const previousBoundary = await stocktakeBoundary(tx, storeId, previous.closingStocktakeId);
      if (closingBoundary.getTime() <= previousBoundary.getTime()) throw new SellThroughError("OUT_OF_ORDER");
    }

    const draft = await tx.konsiSellThrough.findFirst({ where: { storeId, status: "DRAFT" }, select: { id: true } });
    if (draft) throw new SellThroughError("DRAFT_EXISTS");

    const inputs = await loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktake.id, previous });
    const lines = derive({ method, openings: inputs.openings, rows: inputs.rows, counted: inputs.counted });

    /**
     * relationMode = "prisma": KonsiSellThroughLine.item is a required relation with no FK
     * behind it, so every itemId is verified here — a dangling one would write a line whose
     * reads throw "Inconsistent query result" forever.
     */
    const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
    const items = itemIds.length > 0 ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true } }) : [];
    const itemNameById = new Map(items.map((i) => [i.id, i.nameId]));
    for (const id of itemIds) {
      if (!itemNameById.has(id)) throw new SellThroughError("NOT_FOUND", `ITEM:${id}`);
    }

    const stock = itemIds.length > 0
      ? await tx.storeStock.findMany({ where: { storeId, itemId: { in: itemIds } }, select: { itemId: true, variantSku: true, avgCost: true } })
      : [];
    const avgCostByKey = new Map(stock.map((s) => [lineKey(s.itemId, s.variantSku), s.avgCost]));
    const stocktakeNameByKey = new Map(stocktake.lines.map((l) => [lineKey(l.itemId, l.variantSku), l.productName]));

    const docNo = await generateDocNumber("SELLTHRU", tx);

    try {
      return await tx.konsiSellThrough.create({
        data: {
          docNo,
          storeId,
          method,
          status: "DRAFT",
          closingStocktakeId: stocktake.id,
          stocktakeKey: stocktake.id,
          previousId: previous?.id ?? null,
          chainKey: `${storeId}:${previous?.id ?? "root"}`,
          periodStart: inputs.periodStart,
          periodEnd: inputs.periodEnd,
          createdById: input.createdById,
          lines: {
            create: lines.map((l) => {
              const key = lineKey(l.itemId, l.variantSku);
              return {
                itemId: l.itemId,
                variantSku: l.variantSku,
                productName: stocktakeNameByKey.get(key) ?? itemNameById.get(l.itemId)!,
                openingQty: l.openingQty,
                inQty: l.inQty,
                outQty: l.outQty,
                posSoldQty: l.posSoldQty,
                gapQty: l.gapQty,
                closingQty: l.closingQty,
                countedQty: l.countedQty,
                billedQty: l.billedQty,
                shrinkageQty: l.shrinkageQty,
                negativeSold: l.negativeSold,
                suggestedResolution: l.suggestedResolution,
                resolution: null,
                unitCost: avgCostByKey.get(key) ?? 0,
              };
            }),
          },
        },
        select: { id: true, docNo: true },
      });
    } catch (e) {
      if (isUniqueViolationOn(e, "chainKey")) throw new SellThroughError("DRAFT_EXISTS");
      if (isUniqueViolationOn(e, "stocktakeKey")) throw new SellThroughError("ALREADY_USED");
      throw e;
    }
  });
}

/**
 * Confirms an admin's resolution of one held SPG_POS line. The arithmetic and the arm/reason
 * rules live in `applyResolution`; this only maps its refusals onto the writer's codes and writes
 * the result. The prefilled `suggestedResolution` is never read here — only a saved resolution
 * releases the hold.
 */
export async function resolveSellThroughLine(input: {
  lineId: string;
  resolution: SellThroughResolutionValue;
  reason: string | null;
  userId: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    if (!RESOLUTIONS.includes(input.resolution)) throw new SellThroughError("INVALID_RESOLUTION", "UNKNOWN_RESOLUTION");
    if ((input.reason?.trim().length ?? 0) > REASON_MAX_LENGTH) throw new SellThroughError("INVALID_RESOLUTION", "REASON_TOO_LONG");

    const line = await tx.konsiSellThroughLine.findUnique({
      where: { id: input.lineId },
      select: { id: true, posSoldQty: true, gapQty: true, sellThrough: { select: { status: true, method: true } } },
    });
    if (!line) throw new SellThroughError("NOT_FOUND");
    if (line.sellThrough.status !== "DRAFT") throw new SellThroughError("INVALID_STATE");

    let applied: ReturnType<typeof applyResolution>;
    try {
      applied = applyResolution(
        { posSoldQty: roundQty(line.posSoldQty.toNumber()), gapQty: roundQty(line.gapQty.toNumber()) },
        line.sellThrough.method,
        input.resolution,
        input.reason,
      );
    } catch (e) {
      if (e instanceof InvalidResolutionError) {
        throw new SellThroughError(e.reason === "REASON_REQUIRED" ? "REASON_REQUIRED" : "INVALID_RESOLUTION", e.reason);
      }
      throw e;
    }

    await tx.konsiSellThroughLine.update({
      where: { id: line.id },
      data: {
        billedQty: applied.billedQty,
        shrinkageQty: applied.shrinkageQty,
        resolution: input.resolution,
        resolutionReason: applied.resolutionReason,
      },
    });

    return { ok: true as const };
  });
}

/**
 * Freezes a DRAFT report. Slice A moves no money and no stock here. Refused while any SPG_POS
 * gap line lacks a saved resolution, and refused `STALE` when re-deriving the period inside this
 * transaction no longer yields the stored figures — a movement committed into the window after
 * creation (a late-approved retur, say). The remedy for STALE is cancel and recreate, never an
 * in-place refresh, so an approved report always shows the figures the admin actually reviewed.
 */
export async function approveSellThrough(input: { id: string; approvedById: string }): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const doc = await tx.konsiSellThrough.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        storeId: true,
        method: true,
        status: true,
        closingStocktakeId: true,
        previousId: true,
        lines: {
          select: {
            itemId: true,
            variantSku: true,
            openingQty: true,
            inQty: true,
            outQty: true,
            posSoldQty: true,
            gapQty: true,
            closingQty: true,
            resolution: true,
          },
        },
      },
    });
    if (!doc) throw new SellThroughError("NOT_FOUND");
    if (doc.status !== "DRAFT") throw new SellThroughError("INVALID_STATE");

    for (const l of doc.lines) {
      if (isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, doc.method)) {
        throw new SellThroughError("HELD", lineKey(l.itemId, l.variantSku));
      }
    }

    /* An APPROVED report cannot be cancelled, so a stored previousId always resolves; the check is a guard, not a path. */
    const previous = doc.previousId
      ? await tx.konsiSellThrough.findUnique({ where: { id: doc.previousId }, select: { id: true, closingStocktakeId: true } })
      : null;
    if (doc.previousId && !previous) throw new SellThroughError("NOT_FOUND", "PREVIOUS_REPORT");

    const inputs = await loadSellThroughInputs(tx, { storeId: doc.storeId, closingStocktakeId: doc.closingStocktakeId, previous });
    const recomputed = derive({ method: doc.method, openings: inputs.openings, rows: inputs.rows, counted: inputs.counted });

    const freshByKey = new Map(recomputed.map((l) => [lineKey(l.itemId, l.variantSku), l]));
    if (freshByKey.size !== doc.lines.length) throw new SellThroughError("STALE");
    for (const stored of doc.lines) {
      const key = lineKey(stored.itemId, stored.variantSku);
      const fresh = freshByKey.get(key);
      if (!fresh) throw new SellThroughError("STALE", key);
      for (const figure of DERIVED_FIGURES) {
        if (roundQty(stored[figure].toNumber()) !== fresh[figure]) throw new SellThroughError("STALE", key);
      }
    }

    const flipped = await tx.konsiSellThrough.updateMany({
      where: { id: doc.id, status: "DRAFT" },
      data: { status: "APPROVED", approvedById: input.approvedById, approvedAt: new Date() },
    });
    if (flipped.count === 0) throw new SellThroughError("INVALID_STATE");

    return { ok: true as const };
  });
}

/**
 * Abandons a DRAFT report. Nulling `stocktakeKey` and `chainKey` is the whole point: it frees the
 * closing stocktake for a new report and frees the store's chain slot, while `closingStocktakeId`
 * and `previousId` stay as history.
 */
export async function cancelSellThrough(input: { id: string; cancelledById: string; reason: string }): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const reason = input.reason?.trim() ?? "";
    if (reason === "") throw new SellThroughError("REASON_REQUIRED");

    const doc = await tx.konsiSellThrough.findUnique({ where: { id: input.id }, select: { id: true } });
    if (!doc) throw new SellThroughError("NOT_FOUND");

    const flipped = await tx.konsiSellThrough.updateMany({
      where: { id: doc.id, status: "DRAFT" },
      data: {
        status: "CANCELLED",
        cancelledById: input.cancelledById,
        cancelledAt: new Date(),
        cancelReason: reason,
        stocktakeKey: null,
        chainKey: null,
      },
    });
    if (flipped.count === 0) throw new SellThroughError("INVALID_STATE");

    return { ok: true as const };
  });
}
