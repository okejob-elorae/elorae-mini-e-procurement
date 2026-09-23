import { prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";
import { isLineHeld, roundQty, type SellThroughMethodValue, type SellThroughResolutionValue } from "./derive";
import { stocktakeBoundary } from "./window";
import type { SellThroughErrorCode } from "./errors";

export type SellThroughStatusValue = "DRAFT" | "APPROVED" | "CANCELLED";

export type SellThroughListItem = {
  id: string;
  docNo: string;
  storeId: string;
  storeName: string;
  method: SellThroughMethodValue;
  status: SellThroughStatusValue;
  periodStart: Date | null;
  periodEnd: Date;
  heldCount: number;
  billedTotalQty: number;
  createdAt: Date;
};

/**
 * `heldCount` only ever fires for a SPG_POS report — `isLineHeld` is false by construction for
 * SHELF_COUNT (see `derive.ts`) — so the held lookup is scoped to the SPG_POS ids among the page
 * rather than fetching every line of every report. `billedTotalQty` is a plain sum over the whole
 * page in one `groupBy`, unfiltered by method — a SHELF_COUNT total is exactly as meaningful as a
 * SPG_POS one, both being `KonsiSellThroughLine.billedQty`.
 */
export async function listSellThroughs(input: {
  storeId?: string;
  status?: SellThroughStatusValue;
  page: number;
  pageSize: number;
}): Promise<{ items: SellThroughListItem[]; total: number }> {
  const where = {
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.status ? { status: input.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.konsiSellThrough.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        docNo: true,
        storeId: true,
        method: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        store: { select: { name: true } },
      },
    }),
    prisma.konsiSellThrough.count({ where }),
  ]);

  if (rows.length === 0) return { items: [], total };

  const reportIds = rows.map((r) => r.id);
  const spgReportIds = rows.filter((r) => r.method === "SPG_POS").map((r) => r.id);

  const billedAgg = await prisma.konsiSellThroughLine.groupBy({
    by: ["sellThroughId"],
    where: { sellThroughId: { in: reportIds } },
    _sum: { billedQty: true },
  });
  const heldLines =
    spgReportIds.length > 0
      ? await prisma.konsiSellThroughLine.findMany({
          where: { sellThroughId: { in: spgReportIds } },
          select: { sellThroughId: true, gapQty: true, resolution: true },
        })
      : [];

  const billedTotalByReportId = new Map(billedAgg.map((a) => [a.sellThroughId, roundQty(a._sum.billedQty?.toNumber() ?? 0)]));

  const heldCountByReportId = new Map<string, number>();
  for (const l of heldLines) {
    if (isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, "SPG_POS")) {
      heldCountByReportId.set(l.sellThroughId, (heldCountByReportId.get(l.sellThroughId) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      storeId: r.storeId,
      storeName: r.store.name,
      method: r.method,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      heldCount: heldCountByReportId.get(r.id) ?? 0,
      billedTotalQty: billedTotalByReportId.get(r.id) ?? 0,
      createdAt: r.createdAt,
    })),
    total,
  };
}

export type SellThroughLineDetail = {
  id: string;
  itemId: string;
  variantSku: string;
  variantLabel: string | null;
  productName: string;
  openingQty: number;
  inQty: number;
  outQty: number;
  posSoldQty: number;
  gapQty: number;
  closingQty: number;
  countedQty: number | null;
  billedQty: number;
  shrinkageQty: number;
  negativeSold: boolean;
  suggestedResolution: SellThroughResolutionValue | null;
  resolution: SellThroughResolutionValue | null;
  resolutionReason: string | null;
  unitCost: number;
  held: boolean;
};

export type SellThroughDetail = {
  id: string;
  docNo: string;
  storeId: string;
  storeName: string;
  method: SellThroughMethodValue;
  status: SellThroughStatusValue;
  closingStocktakeId: string;
  closingStocktakeDocNo: string;
  previousId: string | null;
  previousDocNo: string | null;
  periodStart: Date | null;
  periodEnd: Date;
  createdById: string;
  createdAt: Date;
  approvedById: string | null;
  approvedAt: Date | null;
  cancelledById: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  lines: SellThroughLineDetail[];
};

export async function getSellThrough(id: string): Promise<SellThroughDetail | null> {
  const doc = await prisma.konsiSellThrough.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      storeId: true,
      method: true,
      status: true,
      closingStocktakeId: true,
      previousId: true,
      periodStart: true,
      periodEnd: true,
      createdById: true,
      createdAt: true,
      approvedById: true,
      approvedAt: true,
      cancelledById: true,
      cancelledAt: true,
      cancelReason: true,
      store: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          productName: true,
          openingQty: true,
          inQty: true,
          outQty: true,
          posSoldQty: true,
          gapQty: true,
          closingQty: true,
          countedQty: true,
          billedQty: true,
          shrinkageQty: true,
          negativeSold: true,
          suggestedResolution: true,
          resolution: true,
          resolutionReason: true,
          unitCost: true,
          item: { select: { variants: true } },
        },
      },
    },
  });
  if (!doc) return null;

  /* relationMode = "prisma": neither closingStocktakeId nor previousId carries a database FK, so both docNo lookups are best-effort and fall back to an empty/null label rather than throwing. */
  const [closingStocktake, previous] = await Promise.all([
    prisma.storeStocktake.findUnique({ where: { id: doc.closingStocktakeId }, select: { docNo: true } }),
    doc.previousId
      ? prisma.konsiSellThrough.findUnique({ where: { id: doc.previousId }, select: { docNo: true } })
      : Promise.resolve(null),
  ]);

  return {
    id: doc.id,
    docNo: doc.docNo,
    storeId: doc.storeId,
    storeName: doc.store.name,
    method: doc.method,
    status: doc.status,
    closingStocktakeId: doc.closingStocktakeId,
    closingStocktakeDocNo: closingStocktake?.docNo ?? "",
    previousId: doc.previousId,
    previousDocNo: previous?.docNo ?? null,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    createdById: doc.createdById,
    createdAt: doc.createdAt,
    approvedById: doc.approvedById,
    approvedAt: doc.approvedAt,
    cancelledById: doc.cancelledById,
    cancelledAt: doc.cancelledAt,
    cancelReason: doc.cancelReason,
    lines: doc.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      variantSku: l.variantSku,
      variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
      productName: l.productName,
      openingQty: roundQty(l.openingQty.toNumber()),
      inQty: roundQty(l.inQty.toNumber()),
      outQty: roundQty(l.outQty.toNumber()),
      posSoldQty: roundQty(l.posSoldQty.toNumber()),
      gapQty: roundQty(l.gapQty.toNumber()),
      closingQty: roundQty(l.closingQty.toNumber()),
      countedQty: l.countedQty === null ? null : roundQty(l.countedQty.toNumber()),
      billedQty: roundQty(l.billedQty.toNumber()),
      shrinkageQty: roundQty(l.shrinkageQty.toNumber()),
      negativeSold: l.negativeSold,
      suggestedResolution: l.suggestedResolution,
      resolution: l.resolution,
      resolutionReason: l.resolutionReason,
      unitCost: l.unitCost.toNumber(),
      held: isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, doc.method),
    })),
  };
}

/**
 * Read-only mirror of `createSellThrough`'s preconditions (writer.ts), in the SAME order, up to
 * and including `DRAFT_EXISTS` — the last check before the write path derives lines and creates
 * the row. Deliberately does NOT run `loadSellThroughInputs`/`deriveSellThroughLines`: an unknown
 * ledger refType or a dangling item id are write-time failures the eligibility check has no
 * business predicting, and the real create call remains the authoritative gate regardless of what
 * this reports — this is advisory, same as the create-time credit-limit flag elsewhere in the
 * app. Kept as its own read-only implementation rather than sharing writer.ts's transaction body,
 * so this task cannot risk writer.ts's already-passing behaviour.
 */
export async function getSellThroughEligibility(
  stocktakeId: string,
): Promise<{ eligible: true } | { eligible: false; reason: SellThroughErrorCode; existingId?: string }> {
  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.storeStocktake.findUnique({
      where: { id: stocktakeId },
      select: { id: true, storeId: true, status: true, isFullCount: true },
    });
    if (!stocktake) return { eligible: false, reason: "NOT_FOUND" };
    if (stocktake.status !== "APPROVED") return { eligible: false, reason: "STOCKTAKE_NOT_APPROVED" };
    if (!stocktake.isFullCount) return { eligible: false, reason: "NOT_FULL_COUNT" };

    const storeId = stocktake.storeId;
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { termsType: true, sellThroughMethod: true } });
    if (!store) return { eligible: false, reason: "NOT_FOUND" };
    if (store.termsType !== "KONSI") return { eligible: false, reason: "NOT_KONSI" };
    if (!store.sellThroughMethod) return { eligible: false, reason: "METHOD_NOT_SET" };

    const used = await tx.konsiSellThrough.findUnique({ where: { stocktakeKey: stocktake.id }, select: { id: true } });
    if (used) return { eligible: false, reason: "ALREADY_USED", existingId: used.id };

    const previous = await tx.konsiSellThrough.findFirst({
      where: { storeId, status: "APPROVED" },
      orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
      select: { id: true, closingStocktakeId: true },
    });
    if (previous) {
      const closingBoundary = await stocktakeBoundary(tx, storeId, stocktake.id);
      const previousBoundary = await stocktakeBoundary(tx, storeId, previous.closingStocktakeId);
      if (closingBoundary.getTime() <= previousBoundary.getTime()) {
        return { eligible: false, reason: "OUT_OF_ORDER" };
      }
    }

    const draft = await tx.konsiSellThrough.findFirst({ where: { storeId, status: "DRAFT" }, select: { id: true } });
    if (draft) return { eligible: false, reason: "DRAFT_EXISTS" };

    return { eligible: true };
  });
}
