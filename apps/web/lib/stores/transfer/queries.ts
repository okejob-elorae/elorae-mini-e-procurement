import { prisma, Prisma } from "@elorae/db";

export type StoreTransferStatusValue = "PENDING" | "APPROVED" | "CANCELLED";

export type StoreTransferListRow = {
  id: string;
  docNo: string;
  fromStoreName: string;
  toStoreName: string;
  status: StoreTransferStatusValue;
  lineCount: number;
  createdAt: Date;
};

/**
 * `q` matches the doc number or either store's name — a transfer is identified by both ends,
 * so a search that only reached `fromStore` would miss "find the transfer that moved stock
 * INTO store X" queries.
 */
export async function listStoreTransfers(params: {
  status?: StoreTransferStatusValue;
  q?: string;
  page: number;
  perPage: number;
}): Promise<{ rows: StoreTransferListRow[]; total: number }> {
  const q = params.q?.trim();
  const where: Prisma.StoreTransferWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(q
      ? {
          OR: [
            { docNo: { contains: q } },
            { fromStore: { name: { contains: q } } },
            { toStore: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.storeTransfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        docNo: true,
        status: true,
        createdAt: true,
        fromStore: { select: { name: true } },
        toStore: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.storeTransfer.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      fromStoreName: r.fromStore.name,
      toStoreName: r.toStore.name,
      status: r.status,
      lineCount: r._count.lines,
      createdAt: r.createdAt,
    })),
    total,
  };
}

export type StoreTransferLineDetail = {
  id: string;
  itemId: string;
  itemSku: string;
  variantSku: string;
  productName: string;
  qty: number;
  unitCost: number;
  lineValue: number;
};

export type StoreTransferDetail = {
  id: string;
  docNo: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  movedAt: Date;
  status: StoreTransferStatusValue;
  note: string | null;
  createdByLabel: string;
  createdAt: Date;
  approvedByLabel: string | null;
  approvedAt: Date | null;
  lines: StoreTransferLineDetail[];
};

export async function getStoreTransferById(id: string): Promise<StoreTransferDetail | null> {
  const r = await prisma.storeTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      fromStoreId: true,
      toStoreId: true,
      movedAt: true,
      status: true,
      note: true,
      createdById: true,
      createdAt: true,
      approvedById: true,
      approvedAt: true,
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          productName: true,
          qty: true,
          unitCost: true,
          item: { select: { sku: true } },
        },
      },
    },
  });
  if (!r) return null;

  /*
   * createdById/approvedById are bare scalars with no relation (relationMode = "prisma"), so
   * labels are one batched lookup rather than two includes — same idiom as the stocktake and
   * field-return detail queries.
   */
  const userIds = Array.from(new Set([r.createdById, r.approvedById].filter((x): x is string => x !== null)));
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const labelFor = (userId: string | null): string | null => (userId ? labelById.get(userId) ?? "—" : null);

  return {
    id: r.id,
    docNo: r.docNo,
    fromStoreId: r.fromStoreId,
    fromStoreName: r.fromStore.name,
    toStoreId: r.toStoreId,
    toStoreName: r.toStore.name,
    movedAt: r.movedAt,
    status: r.status,
    note: r.note,
    createdByLabel: labelFor(r.createdById) ?? "—",
    createdAt: r.createdAt,
    approvedByLabel: labelFor(r.approvedById),
    approvedAt: r.approvedAt,
    lines: r.lines.map((l) => {
      const qty = l.qty.toNumber();
      const unitCost = l.unitCost.toNumber();
      return {
        id: l.id,
        itemId: l.itemId,
        itemSku: l.item.sku,
        variantSku: l.variantSku,
        productName: l.productName,
        qty,
        unitCost,
        lineValue: qty * unitCost,
      };
    }),
  };
}

export type StoreStockOptionRow = {
  itemId: string;
  variantSku: string;
  itemSku: string;
  productName: string;
  qty: number;
};

/**
 * Every `StoreStock` row the source store currently holds — the create form's item picker is
 * built from this, one option per item/variant, rather than the full item catalog, because a
 * transfer moves what a store actually has on its shelf right now. A store with no row at all
 * for an item genuinely holds none of it, so there is nothing to pick — same reasoning
 * `buildStocktakeLines` uses for its own zero-row omission, just without that helper's
 * assortment merge (a transfer is not obligated to surface an item the store has never
 * received). Negative rows are included, not filtered out — `moveStoreStock` allows a store
 * balance to go negative by design, and hiding an already-negative row would make it
 * impossible to ever transfer it further or correct it via a transfer.
 */
export async function getStoreStockForTransfer(storeId: string): Promise<StoreStockOptionRow[]> {
  const rows = await prisma.storeStock.findMany({
    where: { storeId },
    select: {
      itemId: true,
      variantSku: true,
      qty: true,
      item: { select: { sku: true, nameId: true } },
    },
    orderBy: [{ item: { nameId: "asc" } }, { variantSku: "asc" }],
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    variantSku: r.variantSku,
    itemSku: r.item.sku,
    productName: r.item.nameId,
    qty: r.qty.toNumber(),
  }));
}
