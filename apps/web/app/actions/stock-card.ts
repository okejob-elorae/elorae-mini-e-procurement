'use server';

import { prisma } from '@elorae/db';
import { ItemType } from '@elorae/db';

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

/*
 * Splits a signed ledger qty into in/out columns by SIGN, not by StockLedgerType. The two
 * enums do not line up: StockLedgerType.ADJUSTMENT is signed either way (a physical-count
 * correction from setMainStock/setStoreStock can move the balance up or down), and OPENING is
 * a balance snapshot, not a movement (its qty equals its own balanceQty). A zero-qty
 * ADJUSTMENT (a value-only correction, or a true no-op) renders in neither column. The `type`
 * field itself is still returned for reference/badge use, but never consulted here.
 */
function splitInOut(qty: number): { in: number | null; out: number | null } {
  if (qty > 0) return { in: qty, out: null };
  if (qty < 0) return { in: null, out: Math.abs(qty) };
  return { in: null, out: null };
}

/*
 * balanceValue/unitCost/totalCost are nullable on StockLedgerEntry: every row written before
 * Tasks A1/A2 added those columns has them null, and none can be reconstructed. Null must
 * stay null all the way to the screen - `Number(null)` is 0, which would silently render an
 * unrecorded value as "Rp 0" and assert the stock was worthless.
 */
function nullableNumber(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export async function getStockCard(
  itemId: string,
  dateRange: { from: Date; to: Date },
  variantSku?: string
) {
  const ledgerWhere: Record<string, unknown> = {
    itemId,
    /* The ledger also holds STORE and VAN rows - this card is main-warehouse only, and
       without this filter it would silently start blending in store/van movements for the
       same item without looking obviously wrong on screen. */
    locationType: 'MAIN',
  };
  if (variantSku) {
    ledgerWhere.variantSku = variantSku;
  }

  const openingEntry = await prisma.stockLedgerEntry.findFirst({
    where: {
      ...ledgerWhere,
      createdAt: { lt: dateRange.from },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  /* No prior row means no ledger history before this range at all, i.e. balance and value
     are both genuinely zero - not "not recorded". "Not recorded" only applies once a row
     exists whose balanceValue was never populated (see nullableNumber above). */
  const openingBalance = openingEntry ? Number(openingEntry.balanceQty) : 0;
  const openingValue = openingEntry ? nullableNumber(openingEntry.balanceValue) : 0;

  const entries = await prisma.stockLedgerEntry.findMany({
    where: {
      ...ledgerWhere,
      createdAt: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const itemRow = await prisma.item.findUnique({
    where: { id: itemId },
    include: { uom: true },
  });

  const closingBalance =
    entries.length > 0
      ? Number(entries[entries.length - 1].balanceQty)
      : openingBalance;

  return {
    item: serializeItemForClient(itemRow),
    openingBalance,
    openingValue,
    movements: entries.map((e) => {
      const qty = Number(e.qty);
      const { in: qtyIn, out: qtyOut } = splitInOut(qty);
      return {
        id: e.id,
        date: e.createdAt,
        docNumber: e.refDocNumber,
        variantSku: e.variantSku || null,
        /* Raw refType (StockLedgerRefType vocabulary, not StockMovement's) - the page
           resolves it to a label via ledgerRefMessageKey, the same idiom the movement card
           and the store detail card already use for this exact column. */
        refType: e.refType,
        type: e.type,
        in: qtyIn,
        out: qtyOut,
        balance: Number(e.balanceQty),
        unitCost: nullableNumber(e.unitCost),
        balanceValue: nullableNumber(e.balanceValue),
        /* StockLedgerEntry has no notes column and nothing to derive one from - see the
           landmine note on this file for why it is dropped rather than left stale. */
      };
    }),
    closingBalance,
  };
}

/** Returns variant SKU options for an item (from item.variants, the stock ledger, and stock movement history - the two movement sources are unioned, not swapped, because each covers a gap the other has). Use to populate variant combobox when item is selected, before Load. */
export async function getItemVariantOptions(itemId: string): Promise<string[]> {
  const [item, ledgerVariants, movementVariants] = await Promise.all([
    prisma.item.findUnique({
      where: { id: itemId },
      select: { variants: true },
    }),
    /* Ledger and StockMovement have complementary blind spots, so this unions both rather
     * than swapping one for the other. The ledger's cutover backfill only wrote rows for
     * non-zero balances, so a variant that sat at zero at cutover and has not moved since
     * has zero ledger rows - StockMovement still holds its full history. The ledger in
     * turn covers store/van variants that never wrote StockMovement at all. This function
     * is NOT part of the ledger repoint above and deliberately keeps reading both tables -
     * it still needs whichever one saw a given variant at all, which the stock card queries
     * above no longer need now that they read the ledger's own value columns. The two
     * cannot share a filter: StockLedgerEntry.variantSku is NOT NULL with a '' default, so
     * `{ not: '' }` is its variantless exclusion here - `{ not: null }` (the StockMovement
     * spelling below) does not compile against this column, since null is not assignable
     * to a plain-string StringFilter. */
    prisma.stockLedgerEntry.groupBy({
      by: ['variantSku'],
      where: { itemId, variantSku: { not: '' } },
      _count: { id: true },
    }),
    /* StockMovement.variantSku is nullable, so `{ not: null }` is its own variantless
     * exclusion, distinct from the ledger's `{ not: '' }` above - see that comment for why
     * the two cannot be unified into one filter. */
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
  const fromLedger = ledgerVariants
    .map((g) => g.variantSku)
    .filter((s) => s.trim() !== '');
  const fromMovements = movementVariants
    .map((g) => g.variantSku)
    .filter((s): s is string => s != null && s.trim() !== '');
  const set = new Set<string>([...fromItem, ...fromLedger, ...fromMovements]);
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
  /* null means "not recorded" (a pre-value-column ledger row), never coerced to 0. */
  openingValue: number | null;
  closingBalance: number;
  closingValue: number | null;
  movements: Array<{
    id: string;
    date: Date;
    docNumber: string;
    /* Raw StockLedgerRefType-vocabulary string - resolve via ledgerRefMessageKey on the page. */
    refType: string;
    type: string;
    in: number | null;
    out: number | null;
    balance: number;
    unitCost: number | null;
    balanceValue: number | null;
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

  const openingEntries = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { lt: dateRange.from },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const lastBeforeByItem = new Map<string, (typeof openingEntries)[0]>();
  for (const e of openingEntries) {
    if (!lastBeforeByItem.has(e.itemId)) lastBeforeByItem.set(e.itemId, e);
  }

  const entriesInRange = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { gte: dateRange.from, lte: dateRange.to },
    },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  const byItem = new Map<
    string,
    { openingBalance: number; openingValue: number | null; entries: typeof entriesInRange }
  >();
  for (const item of items) {
    const last = lastBeforeByItem.get(item.id);
    byItem.set(item.id, {
      openingBalance: last ? Number(last.balanceQty) : 0,
      /* No prior row = no history before this range = genuinely 0, same as getStockCard. */
      openingValue: last ? nullableNumber(last.balanceValue) : 0,
      entries: [],
    });
  }
  for (const e of entriesInRange) {
    const rec = byItem.get(e.itemId);
    if (rec) rec.entries.push(e);
  }

  const result: StockCardByTypeItem[] = items.map((item) => {
    const rec = byItem.get(item.id)!;
    let balance = rec.openingBalance;
    let balanceValue = rec.openingValue;
    const serialized: StockCardByTypeItem['movements'] = [];
    for (const e of rec.entries) {
      const qty = Number(e.qty);
      const { in: qtyIn, out: qtyOut } = splitInOut(qty);
      balance = Number(e.balanceQty);
      balanceValue = nullableNumber(e.balanceValue);
      serialized.push({
        id: e.id,
        date: e.createdAt,
        docNumber: e.refDocNumber,
        refType: e.refType,
        type: e.type,
        in: qtyIn,
        out: qtyOut,
        balance,
        unitCost: nullableNumber(e.unitCost),
        balanceValue,
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

  const openingEntries = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { lt: dateRange.from },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const lastBeforeByItem = new Map<string, (typeof openingEntries)[0]>();
  for (const e of openingEntries) {
    if (!lastBeforeByItem.has(e.itemId)) lastBeforeByItem.set(e.itemId, e);
  }

  const entriesInRange = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { gte: dateRange.from, lte: dateRange.to },
    },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  const byItem = new Map<
    string,
    { openingBalance: number; openingValue: number | null; entries: typeof entriesInRange }
  >();
  for (const item of items) {
    const last = lastBeforeByItem.get(item.id);
    byItem.set(item.id, {
      openingBalance: last ? Number(last.balanceQty) : 0,
      /* No prior row = no history before this range = genuinely 0, same as getStockCard. */
      openingValue: last ? nullableNumber(last.balanceValue) : 0,
      entries: [],
    });
  }
  for (const e of entriesInRange) {
    const rec = byItem.get(e.itemId);
    if (rec) rec.entries.push(e);
  }

  const result: StockCardByTypeItem[] = items.map((item) => {
    const rec = byItem.get(item.id)!;
    let balance = rec.openingBalance;
    let balanceValue = rec.openingValue;
    const serialized: StockCardByTypeItem['movements'] = [];
    for (const e of rec.entries) {
      const qty = Number(e.qty);
      const { in: qtyIn, out: qtyOut } = splitInOut(qty);
      balance = Number(e.balanceQty);
      balanceValue = nullableNumber(e.balanceValue);
      serialized.push({
        id: e.id,
        date: e.createdAt,
        docNumber: e.refDocNumber,
        refType: e.refType,
        type: e.type,
        in: qtyIn,
        out: qtyOut,
        balance,
        unitCost: nullableNumber(e.unitCost),
        balanceValue,
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
