'use server';

import { prisma } from '@elorae/db';
import { ItemType } from '@elorae/db';
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseItemVariants } from "@/lib/items/variants";
import { itemDecimalsToNumbers } from "@/lib/items/queries";

/**
 * Every "use server" export is independently callable regardless of what the page gated
 * on, so each export re-checks inventory:view itself. Throws FORBIDDEN like the movement
 * card action does.
 */
async function assertInventoryView(): Promise<void> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.INVENTORY_VIEW)) {
    throw new Error("FORBIDDEN");
  }
}

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

/** Serialize Item for client (no Decimal) - every Decimal column, same as app/actions/inventory.ts */
function serializeItemForClient(
  item: { reorderPoint?: unknown; overReceiveThreshold?: unknown; sellingPrice?: unknown; [k: string]: unknown } | null
): SerializedItemForStockCard | null {
  if (!item) return null;
  return { ...item, ...itemDecimalsToNumbers(item) } as SerializedItemForStockCard;
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

/*
 * The ledger stamps every row with the balance of ITS OWN (item, variant) stock row, so with
 * no variant picked one row's balanceQty is one size's stock, not the item's: an item holding
 * S=10 and M=5 would open at 5 or 10 and its balance column would jump between the sizes. The
 * item's balance is the sum of each variant's latest balance - seed every variant from its
 * last row before the range, overwrite that variant on each row, and sum after every row.
 * With one variant picked there is only one entry, so the sum is that row's own balance.
 * Sums run in cents (both columns are 2dp) so the total never shows float residue.
 */
class VariantBalances {
  private readonly byVariant = new Map<string, { qtyCents: number; valueCents: number | null }>();

  has(variantSku: string): boolean {
    return this.byVariant.has(variantSku);
  }

  set(e: { variantSku: string; balanceQty: unknown; balanceValue: unknown }): void {
    const value = nullableNumber(e.balanceValue);
    this.byVariant.set(e.variantSku, {
      qtyCents: Math.round(Number(e.balanceQty) * 100),
      valueCents: value == null ? null : Math.round(value * 100),
    });
  }

  /* One unrecorded variant value makes the item's value unrecorded too - a sum that skipped
     it would understate the stock's worth without saying so. No variant at all means no
     ledger history before the range, i.e. balance and value are both genuinely zero. */
  total(): { qty: number; value: number | null } {
    let qtyCents = 0;
    let valueCents: number | null = 0;
    for (const b of this.byVariant.values()) {
      qtyCents += b.qtyCents;
      valueCents = valueCents == null || b.valueCents == null ? null : valueCents + b.valueCents;
    }
    return { qty: qtyCents / 100, value: valueCents == null ? null : valueCents / 100 };
  }
}

export async function getStockCard(
  itemId: string,
  dateRange: { from: Date; to: Date },
  variantSku?: string
) {
  await assertInventoryView();
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

  const openingWhere = { ...ledgerWhere, createdAt: { lt: dateRange.from } };
  /* The opening is the last row before the range of the picked variant, or - with none
     picked - the last row of EVERY variant (distinct keeps the first per variant in this
     newest-first order), so it is the item's whole stock (see VariantBalances). */
  const openingEntries = variantSku
    ? await prisma.stockLedgerEntry
        .findFirst({ where: openingWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
        .then((e) => (e ? [e] : []))
    : await prisma.stockLedgerEntry.findMany({
        where: openingWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['variantSku'],
      });

  const balances = new VariantBalances();
  for (const e of openingEntries) balances.set(e);
  const opening = balances.total();

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

  const movements = entries.map((e) => {
    const qty = Number(e.qty);
    const { in: qtyIn, out: qtyOut } = splitInOut(qty);
    balances.set(e);
    const running = balances.total();
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
      balance: running.qty,
      unitCost: nullableNumber(e.unitCost),
      balanceValue: running.value,
      /* StockLedgerEntry has no notes column and nothing to derive one from - see the
         landmine note on this file for why it is dropped rather than left stale. */
    };
  });
  /* After the walk; with no rows in the range it is the opening itself. */
  const closing = balances.total();

  return {
    item: serializeItemForClient(itemRow),
    openingBalance: opening.qty,
    openingValue: opening.value,
    movements,
    closingBalance: closing.qty,
    closingValue: closing.value,
  };
}

/** Returns variant SKU options for an item (from item.variants - also in JSON-text / upper-case-key form -, the stock rows, the stock ledger, and stock movement history - the two movement sources are unioned, not swapped, because each covers a gap the other has). Use to populate variant combobox when item is selected, before Load. */
export async function getItemVariantOptions(itemId: string): Promise<string[]> {
  await assertInventoryView();
  const [item, ledgerVariants, movementVariants, stockVariants] = await Promise.all([
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
    prisma.inventoryValue.findMany({
      where: { itemId, variantSku: { not: null } },
      select: { variantSku: true },
    }),
  ]);
  const fromItem = parseItemVariants(item?.variants)
    .map((v) => (v?.sku != null ? String(v.sku).trim() : ''))
    .filter(Boolean);
  const fromLedger = ledgerVariants
    .map((g) => g.variantSku)
    .filter((s) => s.trim() !== '');
  const fromMovements = [...movementVariants, ...stockVariants]
    .map((g) => g.variantSku)
    .filter((s): s is string => s != null && s.trim() !== '');
  const set = new Set<string>([...fromItem, ...fromLedger, ...fromMovements]);
  return Array.from(set).sort();
}

/** One row per item (aggregated from variant-level InventoryValue rows). */
export async function getCurrentStockSummary() {
  await assertInventoryView();
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

/*
 * Main-warehouse cards for a list of items over a range, each item's balance summed over its
 * variants exactly as getStockCard does with no variant picked (see VariantBalances). Shared
 * by the by-type and by-category views so the two cannot drift apart.
 */
async function mainStockCardsFor<T extends { id: string }>(
  items: T[],
  dateRange: { from: Date; to: Date }
): Promise<StockCardByTypeItem[]> {
  const itemIds = items.map((i) => i.id);

  const openingEntries = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { lt: dateRange.from },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const balancesByItem = new Map<string, VariantBalances>();
  for (const item of items) balancesByItem.set(item.id, new VariantBalances());
  /* Newest first, so the first row seen per (item, variant) is that variant's last row
     before the range. */
  for (const e of openingEntries) {
    const balances = balancesByItem.get(e.itemId);
    if (balances && !balances.has(e.variantSku)) balances.set(e);
  }

  const entriesInRange = await prisma.stockLedgerEntry.findMany({
    where: {
      itemId: { in: itemIds },
      locationType: 'MAIN',
      createdAt: { gte: dateRange.from, lte: dateRange.to },
    },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const entriesByItem = new Map<string, typeof entriesInRange>();
  for (const e of entriesInRange) {
    const list = entriesByItem.get(e.itemId);
    if (list) list.push(e);
    else entriesByItem.set(e.itemId, [e]);
  }

  return items.map((item) => {
    const balances = balancesByItem.get(item.id)!;
    const opening = balances.total();
    const movements: StockCardByTypeItem['movements'] = (entriesByItem.get(item.id) ?? []).map((e) => {
      const qty = Number(e.qty);
      const { in: qtyIn, out: qtyOut } = splitInOut(qty);
      balances.set(e);
      const running = balances.total();
      return {
        id: e.id,
        date: e.createdAt,
        docNumber: e.refDocNumber,
        refType: e.refType,
        type: e.type,
        in: qtyIn,
        out: qtyOut,
        balance: running.qty,
        unitCost: nullableNumber(e.unitCost),
        balanceValue: running.value,
      };
    });
    const closing = balances.total();
    return {
      item: serializeItemForClient(item as { reorderPoint?: unknown; [k: string]: unknown }),
      openingBalance: opening.qty,
      openingValue: opening.value,
      closingBalance: closing.qty,
      closingValue: closing.value,
      movements,
    };
  });
}

/** Stock card aggregated by item type: raw (FABRIC + ACCESSORIES) or finished (FINISHED_GOOD). */
export async function getStockCardByType(
  type: 'raw' | 'finished',
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; type: 'raw' | 'finished' }> {
  await assertInventoryView();
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
  return { items: await mainStockCardsFor(items, dateRange), type };
}

/** Stock card aggregated by item category. */
export async function getStockCardByCategory(
  categoryId: string,
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; category: { id: string; name: string; code: string | null } }> {
  await assertInventoryView();
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
  return {
    items: await mainStockCardsFor(items, dateRange),
    category: { id: category.id, name: category.name, code: category.code },
  };
}
