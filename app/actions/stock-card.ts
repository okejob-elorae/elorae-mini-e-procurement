'use server';

import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Serialized item shape returned to client (no Decimal) */
export type SerializedItemForStockCard = {
  sku: string;
  nameId: string;
  nameEn?: string | null;
  reorderPoint: number | null;
  overReceiveThreshold: number | null;
  sellingPrice: number | null;
  uom?: { code: string; nameId?: string; [k: string]: unknown } | null;
  [k: string]: unknown;
};

/** Serialize Item for client (no Decimal) - same pattern as app/actions/items.ts */
function serializeItemForClient(
  item: { reorderPoint?: unknown; overReceiveThreshold?: unknown; sellingPrice?: unknown; [k: string]: unknown } | null
): SerializedItemForStockCard | null {
  if (!item) return null;
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    overReceiveThreshold: item.overReceiveThreshold != null ? toNum(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? toNum(item.sellingPrice) : null,
  } as SerializedItemForStockCard;
}

function formatMovementDescription(refType: string): string {
  switch (refType) {
    case 'GRN':
      return 'Penerimaan Barang';
    case 'WO_ISSUE':
      return 'Pengeluaran untuk Produksi';
    case 'WO_RECEIPT':
    case 'FG_RECEIPT':
      return 'Penerimaan Hasil Produksi';
    case 'ADJUSTMENT':
      return 'Penyesuaian Stok';
    case 'RETURN':
      return 'Retur';
    case 'VENDOR_RETURN':
      return 'Pengembalian Vendor';
    default:
      return refType;
  }
}

export async function getStockCard(
  itemId: string,
  dateRange: { from: Date; to: Date },
  variantSku?: string
) {
  const movementWhere: Record<string, unknown> = {
    itemId,
  };
  if (variantSku) {
    movementWhere.variantSku = variantSku;
  }

  const openingMovement = await prisma.stockMovement.findFirst({
    where: {
      ...movementWhere,
      createdAt: { lt: dateRange.from },
    },
    orderBy: { createdAt: 'desc' },
  });

  const openingBalance = openingMovement
    ? Number(openingMovement.balanceQty)
    : 0;
  const openingValue = openingMovement
    ? Number(openingMovement.balanceValue)
    : 0;

  const movements = await prisma.stockMovement.findMany({
    where: {
      ...movementWhere,
      createdAt: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const itemRow = await prisma.item.findUnique({
    where: { id: itemId },
    include: { uom: true },
  });

  const closingBalance =
    movements.length > 0
      ? Number(movements[movements.length - 1].balanceQty)
      : openingBalance;

  return {
    item: serializeItemForClient(itemRow),
    openingBalance,
    openingValue,
    movements: movements.map((m) => ({
      id: m.id,
      date: m.createdAt,
      docNumber: m.refDocNumber,
      variantSku: m.variantSku ?? null,
      description: formatMovementDescription(m.refType),
      type: m.type,
      in: m.type === 'IN' ? Number(m.qty) : null,
      out: m.type !== 'IN' ? Math.abs(Number(m.qty)) : null,
      balance: Number(m.balanceQty),
      unitCost: m.unitCost != null ? Number(m.unitCost) : null,
      balanceValue: Number(m.balanceValue),
      notes: m.notes,
    })),
    closingBalance,
    variantBreakdown: await prisma.stockMovement.groupBy({
      by: ['variantSku'],
      where: { itemId, variantSku: { not: null } },
      _count: { id: true },
    }),
  };
}

/** Returns variant SKU options for an item (from item.variants and from stock movement history). Use to populate variant combobox when item is selected, before Load. */
export async function getItemVariantOptions(itemId: string): Promise<string[]> {
  const [item, movementVariants] = await Promise.all([
    prisma.item.findUnique({
      where: { id: itemId },
      select: { variants: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['variantSku'],
      where: { itemId, variantSku: { not: null } },
      _count: { id: true },
    }),
  ]);
  const fromItem: string[] = [];
  if (Array.isArray(item?.variants)) {
    for (const v of item.variants as Array<Record<string, unknown>>) {
      const sku = v?.sku != null ? String(v.sku).trim() : '';
      if (sku) fromItem.push(sku);
    }
  }
  const fromMovements = movementVariants
    .map((g) => g.variantSku)
    .filter((s): s is string => s != null && s.trim() !== '');
  const set = new Set<string>([...fromItem, ...fromMovements]);
  return Array.from(set).sort();
}

/** One row per item (aggregated from variant-level InventoryValue rows). */
export async function getCurrentStockSummary() {
  const rows = await prisma.inventoryValue.findMany({
    include: {
      item: {
        include: { uom: true },
      },
    },
    orderBy: { item: { nameId: 'asc' } },
  });
  const byItem = new Map<
    string,
    { qtyOnHand: number; totalValue: number; item: (typeof rows)[0]['item'] }
  >();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, {
        qtyOnHand: qty,
        totalValue: val,
        item: r.item,
      });
    }
  }
  return Array.from(byItem.entries()).map(([itemId, agg]) => ({
    itemId,
    qtyOnHand: agg.qtyOnHand,
    avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
    totalValue: agg.totalValue,
    item: serializeItemForClient(agg.item as { reorderPoint?: unknown; [k: string]: unknown }),
  }));
}

export type StockCardByTypeItem = {
  item: SerializedItemForStockCard | null;
  openingBalance: number;
  openingValue: number;
  closingBalance: number;
  closingValue: number;
  movements: Array<{
    id: string;
    date: Date;
    docNumber: string | null;
    description: string;
    type: string;
    in: number | null;
    out: number | null;
    balance: number;
    unitCost: number | null;
    balanceValue: number;
    notes: string | null;
  }>;
};

/** Stock card aggregated by item type: raw (FABRIC + ACCESSORIES) or finished (FINISHED_GOOD). */
export async function getStockCardByType(
  type: 'raw' | 'finished',
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; type: 'raw' | 'finished' }> {
  const itemTypes: ItemType[] =
    type === 'raw' ? [ItemType.FABRIC, ItemType.ACCESSORIES] : [ItemType.FINISHED_GOOD];
  const items = await prisma.item.findMany({
    where: { type: { in: itemTypes } },
    include: { uom: true },
    orderBy: { nameId: 'asc' },
  });
  if (items.length === 0) {
    return { items: [], type };
  }
  const itemIds = items.map((i) => i.id);

  const openingMovements = await prisma.stockMovement.findMany({
    where: {
      itemId: { in: itemIds },
      createdAt: { lt: dateRange.from },
    },
    orderBy: { createdAt: 'desc' },
  });
  const lastBeforeByItem = new Map<string, (typeof openingMovements)[0]>();
  for (const m of openingMovements) {
    if (!lastBeforeByItem.has(m.itemId)) lastBeforeByItem.set(m.itemId, m);
  }

  const movementsInRange = await prisma.stockMovement.findMany({
    where: {
      itemId: { in: itemIds },
      createdAt: { gte: dateRange.from, lte: dateRange.to },
    },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }],
  });

  const byItem = new Map<
    string,
    { openingBalance: number; openingValue: number; movements: typeof movementsInRange }
  >();
  for (const item of items) {
    const last = lastBeforeByItem.get(item.id);
    byItem.set(item.id, {
      openingBalance: last ? Number(last.balanceQty) : 0,
      openingValue: last ? Number(last.balanceValue) : 0,
      movements: [],
    });
  }
  for (const m of movementsInRange) {
    const rec = byItem.get(m.itemId);
    if (rec) rec.movements.push(m);
  }

  const result: StockCardByTypeItem[] = items.map((item) => {
    const rec = byItem.get(item.id)!;
    let balance = rec.openingBalance;
    let balanceValue = rec.openingValue;
    const serialized: StockCardByTypeItem['movements'] = [];
    for (const m of rec.movements) {
      balance = Number(m.balanceQty);
      balanceValue = Number(m.balanceValue);
      serialized.push({
        id: m.id,
        date: m.createdAt,
        docNumber: m.refDocNumber,
        description: formatMovementDescription(m.refType),
        type: m.type,
        in: m.type === 'IN' ? Number(m.qty) : null,
        out: m.type !== 'IN' ? Math.abs(Number(m.qty)) : null,
        balance,
        unitCost: m.unitCost != null ? Number(m.unitCost) : null,
        balanceValue,
        notes: m.notes,
      });
    }
    return {
      item: serializeItemForClient(item as { reorderPoint?: unknown; [k: string]: unknown }),
      openingBalance: rec.openingBalance,
      openingValue: rec.openingValue,
      closingBalance: balance,
      closingValue: balanceValue,
      movements: serialized,
    };
  });

  return { items: result, type };
}

/** Stock card aggregated by item category. */
export async function getStockCardByCategory(
  categoryId: string,
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; category: { id: string; name: string; code: string | null } }> {
  const category = await prisma.itemCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, code: true },
  });
  if (!category) {
    return { items: [], category: { id: categoryId, name: '', code: null } };
  }
  const items = await prisma.item.findMany({
    where: { categoryId },
    include: { uom: true },
    orderBy: { nameId: 'asc' },
  });
  if (items.length === 0) {
    return { items: [], category: { id: category.id, name: category.name, code: category.code } };
  }
  const itemIds = items.map((i) => i.id);

  const openingMovements = await prisma.stockMovement.findMany({
    where: {
      itemId: { in: itemIds },
      createdAt: { lt: dateRange.from },
    },
    orderBy: { createdAt: 'desc' },
  });
  const lastBeforeByItem = new Map<string, (typeof openingMovements)[0]>();
  for (const m of openingMovements) {
    if (!lastBeforeByItem.has(m.itemId)) lastBeforeByItem.set(m.itemId, m);
  }

  const movementsInRange = await prisma.stockMovement.findMany({
    where: {
      itemId: { in: itemIds },
      createdAt: { gte: dateRange.from, lte: dateRange.to },
    },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }],
  });

  const byItem = new Map<
    string,
    { openingBalance: number; openingValue: number; movements: typeof movementsInRange }
  >();
  for (const item of items) {
    const last = lastBeforeByItem.get(item.id);
    byItem.set(item.id, {
      openingBalance: last ? Number(last.balanceQty) : 0,
      openingValue: last ? Number(last.balanceValue) : 0,
      movements: [],
    });
  }
  for (const m of movementsInRange) {
    const rec = byItem.get(m.itemId);
    if (rec) rec.movements.push(m);
  }

  const result: StockCardByTypeItem[] = items.map((item) => {
    const rec = byItem.get(item.id)!;
    let balance = rec.openingBalance;
    let balanceValue = rec.openingValue;
    const serialized: StockCardByTypeItem['movements'] = [];
    for (const m of rec.movements) {
      balance = Number(m.balanceQty);
      balanceValue = Number(m.balanceValue);
      serialized.push({
        id: m.id,
        date: m.createdAt,
        docNumber: m.refDocNumber,
        description: formatMovementDescription(m.refType),
        type: m.type,
        in: m.type === 'IN' ? Number(m.qty) : null,
        out: m.type !== 'IN' ? Math.abs(Number(m.qty)) : null,
        balance,
        unitCost: m.unitCost != null ? Number(m.unitCost) : null,
        balanceValue,
        notes: m.notes,
      });
    }
    return {
      item: serializeItemForClient(item as { reorderPoint?: unknown; [k: string]: unknown }),
      openingBalance: rec.openingBalance,
      openingValue: rec.openingValue,
      closingBalance: balance,
      closingValue: balanceValue,
      movements: serialized,
    };
  });

  return { items: result, category: { id: category.id, name: category.name, code: category.code } };
}
