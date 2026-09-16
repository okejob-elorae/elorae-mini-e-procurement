'use server';

import { Decimal } from 'decimal.js';
import { Prisma } from '@elorae/db';
import { prisma, moveMainStock } from '@elorae/db';
import {
  filterAndSortStockItems,
  summarizeStockHealth,
  type StockSort,
  type StockStatus,
} from '@/lib/inventory/stock-status';
import { buildVariantStockChips } from '@/lib/inventory/variant-stock-label';

export interface CostCalculationResult {
  previousQty: Decimal;
  previousAvgCost: Decimal;
  previousTotalValue: Decimal;
  incomingQty: Decimal;
  incomingUnitCost: Decimal;
  incomingTotalValue: Decimal;
  newQty: Decimal;
  newAvgCost: Decimal;
  newTotalValue: Decimal;
}

export type StockRef = {
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

// Prisma compound unique keys don't accept null; use '' for non-variant items.
const normalizeVariantSku = (variantSku?: string | null) => variantSku ?? '';

const compositeKey = (itemId: string, variantSku?: string | null) => ({
  itemId_variantSku: { itemId, variantSku: normalizeVariantSku(variantSku) },
});

/*
 * InventoryValue keys a variantless row as null OR "" — apps/web/lib/items/mutations.ts creates
 * ERP items with null, while some writers use "". A strict findUnique on the normalized ""
 * spelling misses a real null row, so this mirrors moveMainStock's own OR-tolerant lookup
 * exactly (same orderBy tie-break), and the resolved row's id is passed back to moveMainStock as
 * `inventoryValueId` so the write is guaranteed to land on the same row this read found.
 *
 * Exported so every on-hand-stock pre-check in apps/web reuses this exact lookup instead of a
 * hand-rolled spelling of it. The whole point is the tie-break, not just the OR: callers pass the
 * resolved id straight back into moveMainStock as inventoryValueId, so two callers reading the
 * same null/"" bucket must land on the same row or they interleave two independent balances under
 * one ledger key. Current callers: grn.ts's declineGRNByOwner insufficient-stock guard,
 * inventory.ts, reconciliation-runner.ts, opname-snapshot.ts, opname-approve.ts,
 * canvassing/writer.ts, canvassing/reconcile-writer.ts, konsi-transfer/writer.ts,
 * field-sales/retur/approve-writer.ts, and reverseMovingAverage / calculateMovingAverage /
 * reverseInventoryValue below. The one apps/web lookup NOT routed through here is
 * field-sales/writer.ts's hasInventoryRow, an existence check that pins no id.
 *
 * packages/db cannot import this (it sits above apps/web), so it carries its own copies — and
 * there are FOUR, not two. moveMainStock and setMainStock in stock-balance.ts, the return-accept
 * restore in sales-return-writer.ts, and applyJubelioStockAdjustment in stock-writer.ts all
 * restate this shape inline, tie-break included. Change this helper, change all four.
 *
 * Two further packages/db lookups are deliberately a DIFFERENT shape and must not be
 * "harmonised" onto this one: reservation-writer.ts's findFieldSalesInventory prefers an exact
 * "" row and only falls back to null, because a bare OR can decrement the sibling row and orphan
 * reservedQty on an item carrying both spellings; and item-price-writer.ts reads avgCost only,
 * item-level with no variant input at all, so it pins no row and needs no tie-break.
 */
export async function findExistingInventoryValueRow(
  prismaClient: any,
  itemId: string,
  variantSku: string | null | undefined
) {
  return variantSku
    ? prismaClient.inventoryValue.findFirst({
        where: { itemId, variantSku },
      })
    : prismaClient.inventoryValue.findFirst({
        where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
      });
}

export async function calculateMovingAverage(
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;

  // Get current inventory state
  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals
  const newTotalQty = previousQty.plus(incomingQty);
  const incomingTotalValue = incomingQty.mul(incomingCost);
  const newTotalValue = previousTotalValue.plus(incomingTotalValue);

  // Calculate new average cost
  // Formula: (PreviousTotalValue + IncomingTotalValue) / (PreviousQty + IncomingQty)
  let newAvgCost: Decimal;
  if (newTotalQty.gt(0)) {
    newAvgCost = newTotalValue.div(newTotalQty);
  } else {
    newAvgCost = new Decimal(0);
  }

  // createIfMissing only fires when the OR-tolerant read above found no row at all (a genuine
  // never-before-stocked item, matching the upsert this replaced). When it did find a row,
  // inventoryValueId pins the write to that exact row instead of letting moveMainStock
  // re-resolve independently and potentially land on a sibling null/"" row.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: incomingQty.toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    createIfMissing: true,
    inventoryValueId: current?.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty,
    incomingUnitCost: incomingCost,
    incomingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

/**
 * Reverse inventory value for returns/negative adjustments.
 * Outgoing value is at current avg cost; throws if insufficient stock.
 */
export async function reverseInventoryValue(
  itemId: string,
  outgoingQty: Decimal,
  outgoingUnitCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<{ newQty: Decimal; newAvgCost: Decimal; newTotalValue: Decimal }> {
  const prismaClient = tx || prisma;

  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  if (!current) throw new Error('No inventory record found');

  const currentQty = new Decimal(current.qtyOnHand.toString());
  const currentAvgCost = new Decimal(current.avgCost.toString());

  if (currentQty.lt(outgoingQty)) {
    throw new Error('Insufficient stock');
  }

  const newQty = currentQty.minus(outgoingQty);
  const outgoingValue = outgoingQty.mul(currentAvgCost);
  const newTotalValue = new Decimal(current.totalValue.toString()).minus(outgoingValue);

  const newAvgCost = newQty.gt(0)
    ? newTotalValue.div(newQty)
    : new Decimal(0);

  // The `if (!current) throw` above already guards the missing-row case (now correctly — the
  // OR-tolerant read finds the row regardless of null/"" spelling, so it fires only when neither
  // spelling exists), so this never legitimately creates a row — no createIfMissing.
  // inventoryValueId pins the write to the exact row `current` was just read from.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    inventoryValueId: current.id,
    ...ref,
  });

  return { newQty, newAvgCost, newTotalValue };
}

// Reverse calculation for returns (negative quantity) - uses passed cost
export async function reverseMovingAverage(
  itemId: string,
  outgoingQty: Decimal,
  outgoingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;

  // Get current inventory state
  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals (subtracting)
  const newTotalQty = previousQty.minus(outgoingQty);
  const outgoingTotalValue = outgoingQty.mul(outgoingCost);
  const newTotalValue = previousTotalValue.minus(outgoingTotalValue);

  // Average cost remains the same for outgoing (FIFO-like behavior)
  const newAvgCost = previousAvgCost;

  // The OR-tolerant read above resolves the real row regardless of whether it was created with
  // variantSku null or "" — inventoryValueId pins moveMainStock's write to that same row. A
  // genuinely missing row (neither spelling exists) still reaches moveMainStock's own lookup
  // with no createIfMissing set, so it still throws — that part is unchanged.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    inventoryValueId: current?.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty: outgoingQty,
    incomingUnitCost: outgoingCost,
    incomingTotalValue: outgoingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

// Get current inventory value for an item (or item+variant). Serialized for client.
export async function getInventoryValue(itemId: string, variantSku?: string | null) {
  const v = await prisma.inventoryValue.findUnique({
    where: compositeKey(itemId, variantSku),
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          nameEn: true,
          uom: {
            select: {
              code: true,
              nameId: true,
            },
          },
        },
      },
    },
  });
  if (!v) return null;
  return {
    ...v,
    qtyOnHand: Number(v.qtyOnHand),
    avgCost: Number(v.avgCost),
    totalValue: Number(v.totalValue),
  };
}

// Get stock card (movement history) for an item
export async function getStockCard(itemId: string, limit: number = 100) {
  const movements = await prisma.stockMovement.findMany({
    where: { itemId },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  
  return movements;
}

const inventorySnapshotInclude = {
  item: {
    select: {
      sku: true,
      nameId: true,
      nameEn: true,
      type: true,
      reorderPoint: true,
      variants: true,
      uom: {
        select: {
          code: true,
          nameId: true
        }
      }
    }
  }
};

const inventorySnapshotOrderBy = {
  item: {
    sku: 'asc' as const
  }
};

type InventorySnapshotRow = Prisma.InventoryValueGetPayload<{
  include: typeof inventorySnapshotInclude;
}>;

type VariantChipAccum = {
  variantSku: string;
  qtyOnHand: number;
  reservedQty: number;
};

// Aggregate InventoryValue rows by itemId (one row per item; sum qty/reserved/value, weighted avg cost)
// Preserves factual per-variant chips from non-empty variantSku rows.
function aggregateSnapshotByItemId(
  values: InventorySnapshotRow[],
  toNum: (v: unknown) => number | null
) {
  const byItem = new Map<
    string,
    {
      qtyOnHand: number;
      reservedQty: number;
      totalValue: number;
      item: InventorySnapshotRow['item'];
      variantRows: VariantChipAccum[];
    }
  >();
  for (const v of values) {
    const qty = toNum(v.qtyOnHand) ?? 0;
    const reserved = toNum(v.reservedQty) ?? 0;
    const val = toNum(v.totalValue) ?? 0;
    const existing = byItem.get(v.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.reservedQty += reserved;
      existing.totalValue += val;
      existing.variantRows.push({
        variantSku: v.variantSku ?? "",
        qtyOnHand: qty,
        reservedQty: reserved,
      });
    } else {
      byItem.set(v.itemId, {
        qtyOnHand: qty,
        reservedQty: reserved,
        totalValue: val,
        item: v.item,
        variantRows: [
          {
            variantSku: v.variantSku ?? "",
            qtyOnHand: qty,
            reservedQty: reserved,
          },
        ],
      });
    }
  }
  const rows = Array.from(byItem.entries()).map(([itemId, agg]) => {
    const reorderPoint =
      agg.item.reorderPoint != null ? toNum(agg.item.reorderPoint) : null;
    const { variants: itemVariantsJson, ...itemRest } = agg.item;
    const variants = buildVariantStockChips(agg.variantRows, itemVariantsJson);
    return {
      itemId,
      sku: agg.item.sku ?? "",
      qtyOnHand: agg.qtyOnHand,
      reservedQty: agg.reservedQty,
      available: agg.qtyOnHand - agg.reservedQty,
      totalValue: agg.totalValue,
      avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
      reorderPoint,
      variants,
      item: {
        ...itemRest,
        reorderPoint,
      },
    };
  });
  return rows;
}

export type GetInventorySnapshotOpts = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StockStatus;
  sort?: StockSort;
};

// Get inventory snapshot (one row per item, aggregated from variant-level rows)
export async function getInventorySnapshot(opts?: GetInventorySnapshotOpts) {
  const toNum = (v: unknown) => (v == null ? null : Number(v));

  const values = await prisma.inventoryValue.findMany({
    include: inventorySnapshotInclude,
    orderBy: inventorySnapshotOrderBy,
  });

  const allItems = aggregateSnapshotByItemId(values, toNum);
  // Portfolio summary (value / count / health) is always over the full set.
  const totalValue = allItems.reduce((sum, v) => sum + v.totalValue, 0);
  const health = summarizeStockHealth(
    allItems.map((v) => ({
      available: v.available,
      reorderPoint: v.item.reorderPoint,
    })),
  );
  // lowStockItems kept for callers; maps to menipis (excludes habis/negatif).
  const lowStockItems = health.menipisCount;

  // Search filters the list (server-side, across all rows — not just the current page).
  // Also matches against per-variant SKUs (e.g. "27000101P-BLK-XL") so a variant-code
  // search surfaces the article it belongs to.
  const q = opts?.search?.trim().toLowerCase();
  const searched = q
    ? allItems.filter(
        (v) =>
          v.item.sku.toLowerCase().includes(q) ||
          v.item.nameId.toLowerCase().includes(q) ||
          v.variants.some((variant) => variant.variantSku.toLowerCase().includes(q)),
      )
    : allItems;

  const matched = filterAndSortStockItems(searched, {
    status: opts?.status,
    sort: opts?.sort ?? "stock_desc",
  });

  const portfolio = {
    totalValue,
    totalItems: allItems.length,
    lowStockItems,
    totalAvailable: health.totalAvailable,
    menipisCount: health.menipisCount,
    habisCount: health.habisCount,
    negatifCount: health.negatifCount,
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const start = (opts.page - 1) * opts.pageSize;
    const items = matched.slice(start, start + opts.pageSize);
    return {
      items,
      totalCount: matched.length,
      ...portfolio,
    };
  }

  return {
    items: matched,
    totalCount: matched.length,
    ...portfolio,
  };
}
