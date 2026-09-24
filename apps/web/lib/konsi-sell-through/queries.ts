import { prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { variantDetailForSku } from "@/lib/items/variants";
import { isLineHeld, roundQty, type SellThroughMethodValue, type SellThroughResolutionValue } from "./derive";
import { checkSellThroughPreconditions } from "./writer";
import { SellThroughError, type SellThroughErrorCode } from "./errors";
import { priceSellThroughLines } from "./pricing";
import { sellThroughCostTotals, sellThroughJournalGaps } from "./journal";
import { defaultSellThroughSalesmanId } from "./salesman-candidates";

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
  baseline: boolean;
};

/**
 * `heldCount` only ever fires for a DRAFT SPG_POS report — `isLineHeld` is false by construction
 * for SHELF_COUNT (see `derive.ts`), an APPROVED report cannot hold a line, and a CANCELLED one's
 * unresolved gaps will never be resolved, so counting them would flag a report nobody can act on.
 * The held lookup is therefore scoped to the DRAFT SPG_POS ids among the page rather than fetching
 * every line of every report. `billedTotalQty` is a plain sum over the whole page in one `groupBy`,
 * unfiltered by method — a SHELF_COUNT total is exactly as meaningful as a SPG_POS one, both being
 * `KonsiSellThroughLine.billedQty`.
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
        baseline: true,
        store: { select: { name: true } },
      },
    }),
    prisma.konsiSellThrough.count({ where }),
  ]);

  if (rows.length === 0) return { items: [], total };

  const reportIds = rows.map((r) => r.id);
  const draftSpgReportIds = rows.filter((r) => r.method === "SPG_POS" && r.status === "DRAFT").map((r) => r.id);

  const billedAgg = await prisma.konsiSellThroughLine.groupBy({
    by: ["sellThroughId"],
    where: { sellThroughId: { in: reportIds } },
    _sum: { billedQty: true },
  });
  const heldLines =
    draftSpgReportIds.length > 0
      ? await prisma.konsiSellThroughLine.findMany({
          where: { sellThroughId: { in: draftSpgReportIds } },
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
      baseline: r.baseline,
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
  unitPrice: number | null;
  lineTotal: number | null;
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
  createdByLabel: string;
  createdAt: Date;
  approvedById: string | null;
  approvedByLabel: string | null;
  approvedAt: Date | null;
  cancelledById: string | null;
  cancelledByLabel: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  storeMarginPercent: number | null;
  storePaymentTempo: number;
  total: number | null;
  unpricedKeys: string[];
  invoiceDate: Date | null;
  dueDate: Date | null;
  salesmanId: string | null;
  salesmanLabel: string | null;
  baseline: boolean;
  baselineReason: string | null;
  unrelievedCost: number | null;
  receivableId: string | null;
  taxInvoiceId: string | null;
  journalPending: boolean;
  defaultSalesmanId: string | null;
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
      invoiceDate: true,
      dueDate: true,
      total: true,
      salesmanId: true,
      baseline: true,
      baselineReason: true,
      store: { select: { name: true, marginPercent: true, paymentTempo: true } },
      receivable: { select: { id: true } },
      taxInvoice: { select: { id: true } },
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
          unitPrice: true,
          lineTotal: true,
          item: { select: { variants: true, sellingPrice: true } },
        },
      },
    },
  });
  if (!doc) return null;

  /**
   * relationMode = "prisma": neither closingStocktakeId nor previousId carries a database FK, so
   * both docNo lookups are best-effort and fall back to an empty/null label rather than throwing.
   * The three actor ids are bare scalars with no relation at all, so their labels are one batched
   * user lookup, falling back to "—" for an id that resolves to nobody.
   */
  const userIds = Array.from(
    new Set(
      [doc.createdById, doc.approvedById, doc.cancelledById, doc.salesmanId].filter((x): x is string => x !== null),
    ),
  );
  const [closingStocktake, previous, users] = await Promise.all([
    prisma.storeStocktake.findUnique({ where: { id: doc.closingStocktakeId }, select: { docNo: true } }),
    doc.previousId
      ? prisma.konsiSellThrough.findUnique({ where: { id: doc.previousId }, select: { docNo: true } })
      : Promise.resolve(null),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
  ]);
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const labelFor = (userId: string | null): string | null => (userId ? labelById.get(userId) ?? "—" : null);

  /**
   * The DRAFT preview runs the same pricing rule the approve writer uses, so the screen never shows
   * a number invoicing would then disagree with. Once APPROVED (and not a baseline), the lines and
   * total already carry the stored, invoiced figures instead.
   */
  const preview =
    doc.status === "DRAFT"
      ? priceSellThroughLines({
          marginPercent: doc.store.marginPercent === null ? null : Number(doc.store.marginPercent),
          lines: doc.lines.map((l) => ({
            key: `${l.itemId}::${l.variantSku}`,
            billedQty: roundQty(l.billedQty.toNumber()),
            sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
          })),
        })
      : null;
  const invoiced = doc.status === "APPROVED" && !doc.baseline;
  const [defaultSalesmanId, journalGaps] = await Promise.all([
    doc.status === "DRAFT" ? defaultSellThroughSalesmanId(doc.storeId) : Promise.resolve(null),
    invoiced ? sellThroughJournalGaps(doc.id) : Promise.resolve([]),
  ]);
  /* A baseline period was billed outside the ERP, or approved before invoicing existed: nothing here relieved its cost from GL inventory. */
  const unrelievedCost = doc.baseline
    ? (() => {
        const c = sellThroughCostTotals(
          doc.lines.map((l) => ({
            billedQty: l.billedQty.toNumber(),
            shrinkageQty: l.shrinkageQty.toNumber(),
            unitCost: l.unitCost.toNumber(),
          })),
        );
        return roundCents(c.cogs + c.shrinkage);
      })()
    : null;

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
    createdByLabel: labelFor(doc.createdById) ?? "—",
    createdAt: doc.createdAt,
    approvedById: doc.approvedById,
    approvedByLabel: labelFor(doc.approvedById),
    approvedAt: doc.approvedAt,
    cancelledById: doc.cancelledById,
    cancelledByLabel: labelFor(doc.cancelledById),
    cancelledAt: doc.cancelledAt,
    cancelReason: doc.cancelReason,
    storeMarginPercent: doc.store.marginPercent === null ? null : Number(doc.store.marginPercent),
    storePaymentTempo: doc.store.paymentTempo,
    total: preview ? preview.total : doc.total === null ? null : Number(doc.total),
    unpricedKeys: preview?.unpricedKeys ?? [],
    invoiceDate: doc.invoiceDate,
    dueDate: doc.dueDate,
    salesmanId: doc.salesmanId,
    salesmanLabel: labelFor(doc.salesmanId),
    baseline: doc.baseline,
    baselineReason: doc.baselineReason,
    unrelievedCost,
    receivableId: doc.receivable?.id ?? null,
    taxInvoiceId: doc.taxInvoice?.id ?? null,
    journalPending: journalGaps.length > 0,
    defaultSalesmanId,
    lines: doc.lines.map((l, i) => ({
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
      unitPrice: preview ? preview.lines[i].unitPrice : l.unitPrice === null ? null : Number(l.unitPrice),
      lineTotal: preview ? preview.lines[i].lineTotal : l.lineTotal === null ? null : Number(l.lineTotal),
      held: isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, doc.method),
    })),
  };
}

/**
 * Runs `checkSellThroughPreconditions` (writer.ts) read-only against the plain client — the same
 * function `createSellThrough` runs inside its own transaction — so this can never drift from what
 * create actually enforces. Deliberately stops there rather than also running
 * `loadSellThroughInputs`/`deriveSellThroughLines`: an unknown ledger refType or a dangling item id
 * are write-time failures this check has no business predicting, and the real create call remains
 * the authoritative gate regardless of what this reports — advisory only, same as the create-time
 * credit-limit flag elsewhere in the app.
 */
export async function getSellThroughEligibility(
  stocktakeId: string,
): Promise<{ eligible: true } | { eligible: false; reason: SellThroughErrorCode; existingId?: string; detail?: string }> {
  try {
    await checkSellThroughPreconditions(prisma, stocktakeId);
    return { eligible: true };
  } catch (e) {
    if (e instanceof SellThroughError) {
      if (e.code === "ALREADY_USED") return { eligible: false, reason: e.code, existingId: e.detail };
      /* The retur docNos the reason copy names, so the admin knows which returns to finish or cancel. */
      if (e.code === "RETUR_IN_FLIGHT") return { eligible: false, reason: e.code, detail: e.detail };
      return { eligible: false, reason: e.code };
    }
    throw e;
  }
}
