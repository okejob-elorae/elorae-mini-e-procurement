import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import {
  applyResolution,
  deriveSellThroughLines,
  InvalidResolutionError,
  isLineHeld,
  roundQty,
  SELL_THROUGH_RESOLUTIONS,
  UnknownLedgerRefTypeError,
  type DerivedLine,
  type SellThroughMethodValue,
  type SellThroughResolutionValue,
} from "./derive";
import { loadSellThroughInputs, stocktakeBoundary } from "./window";
import { SellThroughError } from "./errors";
import { priceSellThroughLines } from "./pricing";
import { isInvoiceDateAllowed, dueDateFor } from "./invoice-dates";
import { isSellThroughSalesmanCandidate } from "./salesman-candidates";

/* A UX bound on a free-text reason — both columns are TEXT. The screens cap their inputs at the same figure. */
const REASON_MAX_LENGTH = 1000;

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

/* The retur statuses in which goods have left the store's shelf without StoreStock having dropped yet. */
const RETUR_IN_FLIGHT_STATUSES = ["PENDING_WAREHOUSE_RECEIVING", "MISMATCH_PENDING_RESOLUTION", "PENDING_APPROVAL"] as const;

/**
 * Refuses `RETUR_IN_FLIGHT`, naming the returns in `detail`, when a closing count was taken while
 * a retur was in flight: raised on or before the count moment (`countFinishedAt`, or `approvedAt`
 * for a count saved before that column existed) and not approved until after it — still open, or
 * approved later. A retur takes its goods off the shelf when it is raised, but StoreStock only
 * drops later — at approve for a FIELD retur, at receipt plus an approve-time delta for an ADMIN
 * one — so a count in that window records the returned units as a shortfall and the report would
 * bill them. Settling the retur afterwards does not clean the count, which is
 * why a later approval refuses as well as a pending status. CANCELLED never refuses. `approvedAt`
 * is the settle moment for both origins — conservative for an ADMIN retur, whose clean receipt
 * already decremented at `receivedAt`, but its approve-time delta still lands at `approvedAt`.
 *
 * The remedy is never to use this count: finish or cancel the returns, then close the period with
 * a later count. This count's own ledger rows then sit mid-period and net out against the later
 * count's, since the window sums every stocktake row in it.
 */
async function assertNoReturInFlight(
  client: Prisma.TransactionClient | typeof prisma,
  storeId: string,
  countMoment: Date,
): Promise<void> {
  const unsettled = await client.fieldReturn.findMany({
    where: {
      storeId,
      createdAt: { lte: countMoment },
      OR: [{ status: { in: [...RETUR_IN_FLIGHT_STATUSES] } }, { status: "APPROVED", approvedAt: { gt: countMoment } }],
    },
    orderBy: { docNo: "asc" },
    select: { docNo: true },
  });
  if (unsettled.length > 0) throw new SellThroughError("RETUR_IN_FLIGHT", unsettled.map((r) => r.docNo).join(", "));
}

/**
 * The read-only precondition sequence `createSellThrough` enforces before it derives or writes
 * anything, extracted so `getSellThroughEligibility` (queries.ts) can run the exact same checks
 * read-only instead of hand-maintaining a second copy that could drift from this one. The store is
 * derived from the stocktake itself, never from the caller, and ownership/approval/full-count are
 * all checked before `stocktakeBoundary` runs, because that helper trusts its inputs.
 *
 * The order is what the eligibility check shows, so it runs from the reasons that make THIS count
 * unusable towards the ones that clear by themselves. `ALREADY_USED` comes before every other
 * count-level refusal because it is the one the stocktake page turns into a link to the existing
 * report (its id rides in `detail`). `BEFORE_LEDGER_CUTOVER` and `OUT_OF_ORDER` are permanent for
 * the count. `RETUR_IN_FLIGHT` sits after them, since chasing returns is wasted on a count that
 * can never close a period anyway, and before `DRAFT_EXISTS`, which clears once the other draft
 * is approved or cancelled.
 *
 * Takes `Prisma.TransactionClient | typeof prisma` — `createSellThrough` always passes its own
 * `tx`, `getSellThroughEligibility` passes the plain client since it performs no writes and needs
 * no transaction of its own.
 */
export async function checkSellThroughPreconditions(
  client: Prisma.TransactionClient | typeof prisma,
  closingStocktakeId: string,
): Promise<{
  stocktake: {
    id: string;
    storeId: string;
    lines: Array<{ itemId: string; variantSku: string; productName: string }>;
  };
  store: { termsType: string; sellThroughMethod: SellThroughMethodValue | null };
  method: SellThroughMethodValue;
  previous: { id: string; closingStocktakeId: string } | null;
}> {
  const stocktake = await client.storeStocktake.findUnique({
    where: { id: closingStocktakeId },
    select: {
      id: true,
      storeId: true,
      status: true,
      isFullCount: true,
      countFinishedAt: true,
      approvedAt: true,
      lines: { select: { itemId: true, variantSku: true, productName: true } },
    },
  });
  if (!stocktake) throw new SellThroughError("NOT_FOUND", "STOCKTAKE");
  if (stocktake.status !== "APPROVED" || !stocktake.approvedAt) throw new SellThroughError("STOCKTAKE_NOT_APPROVED");
  if (!stocktake.isFullCount) throw new SellThroughError("NOT_FULL_COUNT");

  const storeId = stocktake.storeId;
  const store = await client.store.findUnique({ where: { id: storeId }, select: { termsType: true, sellThroughMethod: true } });
  if (!store) throw new SellThroughError("NOT_FOUND", "STORE");
  if (store.termsType !== "KONSI") throw new SellThroughError("NOT_KONSI");
  if (!store.sellThroughMethod) throw new SellThroughError("METHOD_NOT_SET");
  const method = store.sellThroughMethod;

  const used = await client.konsiSellThrough.findUnique({ where: { stocktakeKey: stocktake.id }, select: { id: true } });
  if (used) throw new SellThroughError("ALREADY_USED", used.id);

  /**
   * A count whose boundary precedes the store's earliest STORE ledger row closes a window with no
   * history behind it — a count approved before the ledger's cutover, or before the store's first
   * recorded movement — and the report it would produce means nothing.
   */
  const closingBoundary = await stocktakeBoundary(client, storeId, stocktake.id);
  const earliest = await client.stockLedgerEntry.findFirst({
    where: { locationType: "STORE", locationId: storeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true },
  });
  if (earliest && closingBoundary.getTime() < earliest.createdAt.getTime()) throw new SellThroughError("BEFORE_LEDGER_CUTOVER");

  const previous = await client.konsiSellThrough.findFirst({
    where: { storeId, status: "APPROVED" },
    orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
    select: { id: true, closingStocktakeId: true },
  });
  if (previous) {
    const previousBoundary = await stocktakeBoundary(client, storeId, previous.closingStocktakeId);
    if (closingBoundary.getTime() <= previousBoundary.getTime()) throw new SellThroughError("OUT_OF_ORDER");
  }

  await assertNoReturInFlight(client, storeId, stocktake.countFinishedAt ?? stocktake.approvedAt);

  const draft = await client.konsiSellThrough.findFirst({ where: { storeId, status: "DRAFT" }, select: { id: true } });
  if (draft) throw new SellThroughError("DRAFT_EXISTS");

  return { stocktake, store, method, previous };
}

/**
 * Creates a DRAFT report from an approved FULL store stocktake of a KONSI store — preconditions
 * enforced by `checkSellThroughPreconditions` above.
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
    const { stocktake, method, previous } = await checkSellThroughPreconditions(tx, input.closingStocktakeId);
    const storeId = stocktake.storeId;

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
    if (!SELL_THROUGH_RESOLUTIONS.includes(input.resolution)) throw new SellThroughError("INVALID_RESOLUTION", "UNKNOWN_RESOLUTION");
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

export type ApproveSellThroughInput =
  | { id: string; approvedById: string; mode: "INVOICE"; invoiceDate: Date; salesmanId: string | null }
  | { id: string; approvedById: string; mode: "BASELINE"; reason: string };

/**
 * Freezes a DRAFT report — and approving IS invoicing. INVOICE mode prices every line at the
 * store's price, stamps the invoice date, the due date, the total and the salesman, and creates
 * the receivable and faktur when the total is above zero. BASELINE mode is for a store's first
 * report only: it freezes the figures with a reason and bills nothing, for a period already
 * invoiced by hand outside the ERP. Journals are posted by the action after commit, not here.
 *
 * It moves no stock. Re-checks, in order: the store is still KONSI (`NOT_KONSI`), no retur was in
 * flight at the closing count (`RETUR_IN_FLIGHT` — a DRAFT created before that rule existed must
 * not slip through), the period still derives to the stored figures (`STALE`), and every SPG_POS
 * gap line has a saved resolution (`HELD`).
 *
 * `STALE` catches the one movement that can still reach a window after creation: a row stamped at
 * or before the boundary by a transaction that committed after the report read it (the race in
 * docs/FOLLOWUPS.md) — in-flight returns are refused up front instead. Its remedy is cancel and
 * recreate, never an in-place refresh, so an approved report always shows the figures the admin
 * actually reviewed. It runs BEFORE the hold, so an admin is never sent to resolve lines on a
 * report that has to be cancelled anyway.
 */
export async function approveSellThrough(input: ApproveSellThroughInput): Promise<{ ok: true; invoiced: boolean }> {
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
        periodEnd: true,
        store: { select: { termsType: true, marginPercent: true, paymentTempo: true } },
        lines: {
          select: {
            id: true,
            itemId: true,
            variantSku: true,
            openingQty: true,
            inQty: true,
            outQty: true,
            posSoldQty: true,
            gapQty: true,
            closingQty: true,
            resolution: true,
            billedQty: true,
            item: { select: { sellingPrice: true } },
          },
        },
      },
    });
    if (!doc) throw new SellThroughError("NOT_FOUND");
    if (doc.status !== "DRAFT") throw new SellThroughError("INVALID_STATE");
    if (doc.store.termsType !== "KONSI") throw new SellThroughError("NOT_KONSI");

    const closing = await tx.storeStocktake.findUnique({
      where: { id: doc.closingStocktakeId },
      select: { countFinishedAt: true, approvedAt: true },
    });
    const countMoment = closing?.countFinishedAt ?? closing?.approvedAt ?? null;
    if (!countMoment) throw new SellThroughError("NOT_FOUND", "STOCKTAKE");
    await assertNoReturInFlight(tx, doc.storeId, countMoment);

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

    for (const l of doc.lines) {
      if (isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, doc.method)) {
        throw new SellThroughError("HELD", lineKey(l.itemId, l.variantSku));
      }
    }

    const approvedAt = new Date();

    if (input.mode === "BASELINE") {
      if (doc.previousId !== null) throw new SellThroughError("BASELINE_NOT_FIRST");
      const reason = input.reason?.trim() ?? "";
      if (reason === "") throw new SellThroughError("BASELINE_REASON_REQUIRED");
      if (reason.length > REASON_MAX_LENGTH) throw new SellThroughError("BASELINE_REASON_REQUIRED", "REASON_TOO_LONG");
      const flipped = await tx.konsiSellThrough.updateMany({
        where: { id: doc.id, status: "DRAFT" },
        data: { status: "APPROVED", approvedById: input.approvedById, approvedAt, baseline: true, baselineReason: reason },
      });
      if (flipped.count === 0) throw new SellThroughError("INVALID_STATE");
      return { ok: true as const, invoiced: false };
    }

    const pricing = priceSellThroughLines({
      marginPercent: doc.store.marginPercent === null ? null : Number(doc.store.marginPercent),
      lines: doc.lines.map((l) => ({
        key: lineKey(l.itemId, l.variantSku),
        billedQty: roundQty(l.billedQty.toNumber()),
        sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
      })),
    });
    if (pricing.unpricedKeys.length > 0) throw new SellThroughError("UNPRICED", pricing.unpricedKeys.join(","));
    if (!isInvoiceDateAllowed(input.invoiceDate, doc.periodEnd, approvedAt)) throw new SellThroughError("INVALID_INVOICE_DATE");
    if (pricing.total > 0 && input.salesmanId === null) throw new SellThroughError("SALESMAN_REQUIRED");
    if (input.salesmanId !== null && !(await isSellThroughSalesmanCandidate(tx, input.salesmanId))) {
      throw new SellThroughError("SALESMAN_INVALID");
    }
    const dueDate = dueDateFor(input.invoiceDate, doc.store.paymentTempo);

    const flipped = await tx.konsiSellThrough.updateMany({
      where: { id: doc.id, status: "DRAFT" },
      data: {
        status: "APPROVED",
        approvedById: input.approvedById,
        approvedAt,
        invoiceDate: input.invoiceDate,
        dueDate,
        total: pricing.total,
        salesmanId: input.salesmanId,
      },
    });
    if (flipped.count === 0) throw new SellThroughError("INVALID_STATE");

    for (const [i, l] of doc.lines.entries()) {
      await tx.konsiSellThroughLine.update({
        where: { id: l.id },
        data: { unitPrice: pricing.lines[i].unitPrice, lineTotal: pricing.lines[i].lineTotal },
      });
    }

    if (pricing.total > 0) {
      await tx.receivable.create({
        data: {
          sellThroughId: doc.id,
          storeId: doc.storeId,
          invoiceDate: input.invoiceDate,
          dueDate,
          originalAmount: pricing.total,
          outstandingAmount: pricing.total,
        },
      });
      await tx.taxInvoice.create({ data: { sellThroughId: doc.id } });
    }

    return { ok: true as const, invoiced: true };
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
    if (reason.length > REASON_MAX_LENGTH) throw new SellThroughError("REASON_REQUIRED", "REASON_TOO_LONG");

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
