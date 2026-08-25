import { prisma, Prisma, type PrismaClient } from "@elorae/db";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type StoreStocktakeStatusValue = "DRAFT" | "PENDING_VERIFICATION" | "APPROVED" | "CANCELLED";
export type StoreStocktakeCauseValue = "SHRINKAGE" | "UNRECORDED_SALE";

export type StocktakeLineDraft = {
  itemId: string;
  variantSku: string;
  productName: string;
  expectedQty: number;
  soldInPeriodQty: number;
};

/**
 * Reads EVERY `StoreStock` row for the store — deliberately no `qty > 0` filter. The zero and
 * negative rows are exactly the ones a stocktake exists to repair (an SPG sale can drive a row
 * negative and there is currently no correction path); filtering them out here would silently
 * defeat the feature.
 *
 * The sold-in-window figure joins `SpgSaleLine` to its parent `SpgSale` — the line itself carries
 * neither `storeId` nor `createdAt` — batched into one findMany + one folded map, not one query
 * per line. `periodFrom === null` means since inception, so the window's lower bound falls back
 * to the epoch rather than being omitted (an omitted `gte` would still need an upper bound, and
 * "since inception" is exactly what a null lower bound means here).
 */
export async function buildStocktakeLines(
  client: AnyClient,
  storeId: string,
  periodFrom: Date | null,
  countedAt: Date,
): Promise<StocktakeLineDraft[]> {
  const stockRows = await client.storeStock.findMany({
    where: { storeId },
    select: {
      itemId: true,
      variantSku: true,
      qty: true,
      item: { select: { nameId: true } },
    },
  });
  if (stockRows.length === 0) return [];

  const itemIds = Array.from(new Set(stockRows.map((r) => r.itemId)));
  const saleLines = await client.spgSaleLine.findMany({
    where: {
      itemId: { in: itemIds },
      spgSale: { storeId, createdAt: { gte: periodFrom ?? new Date(0), lte: countedAt } },
    },
    select: { itemId: true, variantSku: true, qty: true },
  });

  const soldByKey = new Map<string, number>();
  for (const l of saleLines) {
    const key = `${l.itemId}::${l.variantSku}`;
    soldByKey.set(key, (soldByKey.get(key) ?? 0) + l.qty);
  }

  return stockRows.map((r) => ({
    itemId: r.itemId,
    variantSku: r.variantSku,
    productName: r.item.nameId,
    expectedQty: r.qty.toNumber(),
    soldInPeriodQty: soldByKey.get(`${r.itemId}::${r.variantSku}`) ?? 0,
  }));
}

/**
 * The newest `countedAt` among the store's APPROVED stocktakes only — a CANCELLED document never
 * established a baseline, and an open (DRAFT / PENDING_VERIFICATION) one has not been confirmed
 * yet, so both are ignored. `null` means the store's first count; the caller's window then runs
 * since inception.
 */
export async function previousApprovedCountedAt(client: AnyClient, storeId: string): Promise<Date | null> {
  const row = await client.storeStocktake.findFirst({
    where: { storeId, status: "APPROVED" },
    orderBy: { countedAt: "desc" },
    select: { countedAt: true },
  });
  return row?.countedAt ?? null;
}

export type StoreStocktakeListRow = {
  id: string;
  docNo: string;
  storeName: string;
  status: StoreStocktakeStatusValue;
  countedAt: Date;
  isFullCount: boolean;
  lineCount: number;
  countedLineCount: number;
  netVarianceQty: number;
  createdAt: Date;
};

/**
 * `lines` is selected here (not `_count`) because the register needs `countedLineCount` and
 * `netVarianceQty` per row — both derived in JS from the same minimal projection, since Prisma
 * has no aggregate-sum-over-a-relation in a `findMany` select. A store's line count is small
 * (one row per consignment SKU), so this stays one query per page rather than N.
 */
export async function listStoreStocktakes(params: {
  storeId?: string;
  status?: StoreStocktakeStatusValue;
  q?: string;
  page: number;
  perPage: number;
}): Promise<{ rows: StoreStocktakeListRow[]; total: number }> {
  const q = params.q?.trim();
  const where: Prisma.StoreStocktakeWhereInput = {
    ...(params.storeId ? { storeId: params.storeId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(q ? { OR: [{ docNo: { contains: q } }, { store: { name: { contains: q } } }] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.storeStocktake.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        docNo: true,
        status: true,
        countedAt: true,
        isFullCount: true,
        createdAt: true,
        store: { select: { name: true } },
        lines: { select: { countedQty: true, varianceQty: true } },
      },
    }),
    prisma.storeStocktake.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      storeName: r.store.name,
      status: r.status,
      countedAt: r.countedAt,
      isFullCount: r.isFullCount,
      lineCount: r.lines.length,
      countedLineCount: r.lines.filter((l) => l.countedQty !== null).length,
      netVarianceQty: r.lines.reduce((sum, l) => sum + (l.varianceQty === null ? 0 : l.varianceQty.toNumber()), 0),
      createdAt: r.createdAt,
    })),
    total,
  };
}

export type StoreStocktakeLineDetail = {
  id: string;
  itemId: string;
  itemSku: string;
  variantSku: string;
  productName: string;
  expectedQty: number;
  countedQty: number | null;
  varianceQty: number | null;
  soldInPeriodQty: number;
  cause: StoreStocktakeCauseValue | null;
  reason: string | null;
  qtyAtApproval: number | null;
  appliedQty: number | null;
  isAdded: boolean;
  /**
   * `StoreStock.qty` as it stands right now, read fresh on every detail fetch — never the
   * `expectedQty` snapshot frozen at creation. This is the field the approve dialog's drift list
   * compares `expectedQty` against; 0 when the store has no `StoreStock` row for this item/variant
   * at all (an added line, or one the ledger genuinely never held).
   */
  liveQty: number;
};

export type StoreStocktakeDetail = {
  id: string;
  docNo: string;
  storeId: string;
  storeName: string;
  status: StoreStocktakeStatusValue;
  countedAt: Date;
  periodFrom: Date | null;
  isFullCount: boolean;
  note: string | null;
  createdByLabel: string;
  createdAt: Date;
  submittedByLabel: string | null;
  submittedAt: Date | null;
  approvedByLabel: string | null;
  approvedAt: Date | null;
  cancelledByLabel: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  lines: StoreStocktakeLineDetail[];
};

export async function getStoreStocktakeById(id: string): Promise<StoreStocktakeDetail | null> {
  const r = await prisma.storeStocktake.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      storeId: true,
      status: true,
      countedAt: true,
      periodFrom: true,
      isFullCount: true,
      note: true,
      createdById: true,
      createdAt: true,
      submittedById: true,
      submittedAt: true,
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
          expectedQty: true,
          countedQty: true,
          varianceQty: true,
          soldInPeriodQty: true,
          cause: true,
          reason: true,
          qtyAtApproval: true,
          appliedQty: true,
          isAdded: true,
          item: { select: { sku: true } },
        },
      },
    },
  });
  if (!r) return null;

  /*
   * createdById/submittedById/approvedById/cancelledById are bare scalars with no relation
   * (relationMode = "prisma"), so labels are one batched lookup rather than four includes.
   */
  const userIds = Array.from(
    new Set([r.createdById, r.submittedById, r.approvedById, r.cancelledById].filter((x): x is string => x !== null)),
  );
  const users = userIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const labelFor = (userId: string | null): string | null => (userId ? labelById.get(userId) ?? "—" : null);

  /*
   * One batched read of the store's CURRENT StoreStock, keyed the same way the writer keys its
   * own upsert (itemId + variantSku, defaulting a null variantSku to ""). Never trusted as a
   * substitute for `expectedQty` — this is purely the live figure the approve dialog shows
   * alongside the frozen snapshot.
   */
  const itemIds = Array.from(new Set(r.lines.map((l) => l.itemId)));
  const liveStock = itemIds.length > 0
    ? await prisma.storeStock.findMany({
        where: { storeId: r.storeId, itemId: { in: itemIds } },
        select: { itemId: true, variantSku: true, qty: true },
      })
    : [];
  const liveQtyByKey = new Map(liveStock.map((s) => [`${s.itemId}::${s.variantSku}`, s.qty.toNumber()]));

  return {
    id: r.id,
    docNo: r.docNo,
    storeId: r.storeId,
    storeName: r.store.name,
    status: r.status,
    countedAt: r.countedAt,
    periodFrom: r.periodFrom,
    isFullCount: r.isFullCount,
    note: r.note,
    createdByLabel: labelFor(r.createdById) ?? "—",
    createdAt: r.createdAt,
    submittedByLabel: labelFor(r.submittedById),
    submittedAt: r.submittedAt,
    approvedByLabel: labelFor(r.approvedById),
    approvedAt: r.approvedAt,
    cancelledByLabel: labelFor(r.cancelledById),
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    lines: r.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemSku: l.item.sku,
      variantSku: l.variantSku,
      productName: l.productName,
      expectedQty: l.expectedQty.toNumber(),
      countedQty: l.countedQty === null ? null : l.countedQty.toNumber(),
      varianceQty: l.varianceQty === null ? null : l.varianceQty.toNumber(),
      soldInPeriodQty: l.soldInPeriodQty.toNumber(),
      cause: l.cause,
      reason: l.reason,
      qtyAtApproval: l.qtyAtApproval === null ? null : l.qtyAtApproval.toNumber(),
      appliedQty: l.appliedQty === null ? null : l.appliedQty.toNumber(),
      isAdded: l.isAdded,
      liveQty: liveQtyByKey.get(`${l.itemId}::${l.variantSku}`) ?? 0,
    })),
  };
}
