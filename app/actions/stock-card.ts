'use server';

import { prisma } from '@/lib/prisma';

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
