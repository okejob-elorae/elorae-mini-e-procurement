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
  uom?: { code: string; nameId?: string; [k: string]: unknown } | null;
  [k: string]: unknown;
};

/** Serialize Item for client (no Decimal) - same pattern as app/actions/items.ts */
function serializeItemForClient(
  item: { reorderPoint?: unknown; [k: string]: unknown } | null
): SerializedItemForStockCard | null {
  if (!item) return null;
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
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
    default:
      return refType;
  }
}

export async function getStockCard(
  itemId: string,
  dateRange: { from: Date; to: Date }
) {
  const openingMovement = await prisma.stockMovement.findFirst({
    where: {
      itemId,
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
      itemId,
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
  };
}

export async function getCurrentStockSummary() {
  const rows = await prisma.inventoryValue.findMany({
    include: {
      item: {
        include: { uom: true },
      },
    },
    orderBy: { item: { nameId: 'asc' } },
  });
  return rows.map((r) => ({
    ...r,
    qtyOnHand: Number(r.qtyOnHand),
    avgCost: Number(r.avgCost),
    totalValue: Number(r.totalValue),
    item: serializeItemForClient(r.item as { reorderPoint?: unknown; [k: string]: unknown }),
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
