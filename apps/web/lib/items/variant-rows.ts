import { prisma } from "@elorae/db";
import type { ItemType } from "@/lib/constants/enums";
import { parseItemVariants } from "@/lib/items/variants";
import { matchKey } from "@/lib/items/match-key";
import { aggregateInventoryValues, buildItemsWhere, type ListItemsFilters, type ListItemsOpts } from "@/lib/items/queries";

export { matchKey };

export type VariantRowItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  uomCode: string;
  sellingPrice: number | null;
  variants: unknown;
};

export type VariantRowInventory = {
  itemId: string;
  variantSku: string | null;
  qtyOnHand: number;
  reservedQty: number;
  totalValue: number;
};

export type ItemVariantListRow = {
  key: string;
  itemId: string;
  /** `""` is the variantless bucket, folding both the `null` and `""` spellings of it. */
  variantSku: string;
  code: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  uomCode: string;
  sellingPrice: number | null;
  attributes: Array<{ key: string; value: string }>;
  barcode: string | null;
  /** False for stock held under a key `Item.variants` does not list — shown so it never vanishes. */
  inCatalog: boolean;
  qtyOnHand: number;
  reservedQty: number;
  available: number;
  avgCost: number;
  totalValue: number;
};

type CatalogVariant = { sku: string; attributes: Array<{ key: string; value: string }>; barcode: string | null };

function catalogVariants(raw: unknown): CatalogVariant[] {
  const seen = new Set<string>();
  const out: CatalogVariant[] = [];
  for (const row of parseItemVariants(raw)) {
    const sku = (row.sku ?? "").trim();
    if (sku === "" || seen.has(matchKey(sku))) continue;
    seen.add(matchKey(sku));
    const attributes = Object.entries(row)
      .filter(([k, v]) => k !== "sku" && k !== "barcode" && v != null && String(v).trim() !== "")
      .map(([k, v]) => ({ key: k, value: String(v).trim() }));
    const barcode = (row.barcode ?? "").trim();
    out.push({ sku, attributes, barcode: barcode === "" ? null : barcode });
  }
  return out;
}

function matchesSearch(needle: string, fields: Array<string | null>): boolean {
  return fields.some((f) => f !== null && f.toLowerCase().includes(needle));
}

/**
 * The one search rule: a row survives when the needle is empty, matches its product's SKU or
 * name (which keeps every variant of that product), or matches the row's own variant SKU or barcode.
 */
function rowMatchesSearch(
  needle: string,
  item: VariantRowItem,
  row: { variantSku: string; barcode: string | null },
): boolean {
  if (needle === "") return true;
  return (
    matchesSearch(needle, [item.sku, item.nameId, item.nameEn]) || matchesSearch(needle, [row.variantSku, row.barcode])
  );
}

/**
 * One row per (item, variant key). Catalog variants come first in catalog order, then any
 * inventory key the catalog does not list that still holds stock, a reservation or value — the
 * variantless `""` bucket first, the rest by SKU. A variantless item always gets its `""` row.
 * Inventory is grouped on the normalised key, so an item holding both a `null` and a `""` row
 * shows one row carrying their sum, and every item's rows add up to its product-level figures.
 */
export function buildVariantRows(
  items: VariantRowItem[],
  inventory: VariantRowInventory[],
  search: string,
): ItemVariantListRow[] {
  type InventoryGroup = { spelling: string; rows: VariantRowInventory[] };
  const invByItem = new Map<string, Map<string, InventoryGroup>>();
  for (const row of inventory) {
    const key = matchKey(row.variantSku);
    const byKey = invByItem.get(row.itemId) ?? new Map<string, InventoryGroup>();
    const group = byKey.get(key) ?? { spelling: (row.variantSku ?? "").trim(), rows: [] };
    group.rows.push(row);
    byKey.set(key, group);
    invByItem.set(row.itemId, byKey);
  }

  const needle = search.trim().toLowerCase();
  const out: ItemVariantListRow[] = [];

  for (const item of items) {
    const byKey = invByItem.get(item.id) ?? new Map<string, InventoryGroup>();
    const catalog = catalogVariants(item.variants);
    const catalogKeys = new Set(catalog.map((v) => matchKey(v.sku)));

    const pushRow = (variantSku: string, variant: CatalogVariant | null, inCatalog: boolean) => {
      if (!rowMatchesSearch(needle, item, { variantSku, barcode: variant?.barcode ?? null })) return;
      const stock = aggregateInventoryValues(byKey.get(matchKey(variantSku))?.rows);
      out.push({
        key: `${item.id}|${variantSku}`,
        itemId: item.id,
        variantSku,
        code: variantSku === "" ? item.sku : variantSku,
        nameId: item.nameId,
        nameEn: item.nameEn,
        type: item.type,
        uomCode: item.uomCode,
        sellingPrice: item.sellingPrice,
        attributes: variant?.attributes ?? [],
        barcode: variant?.barcode ?? null,
        inCatalog,
        qtyOnHand: stock?.qtyOnHand ?? 0,
        reservedQty: stock?.reservedQty ?? 0,
        available: stock?.available ?? 0,
        avgCost: stock?.avgCost ?? 0,
        totalValue: stock?.totalValue ?? 0,
      });
    };

    for (const variant of catalog) pushRow(variant.sku, variant, true);
    if (catalog.length === 0) pushRow("", null, true);

    const offCatalog = Array.from(byKey.keys())
      .filter((key) => !catalogKeys.has(key) && !(catalog.length === 0 && key === ""))
      .filter((key) => {
        const stock = aggregateInventoryValues(byKey.get(key)?.rows);
        return stock !== null && (stock.qtyOnHand !== 0 || stock.reservedQty !== 0 || stock.totalValue !== 0);
      })
      .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    for (const key of offCatalog) pushRow(byKey.get(key)?.spelling ?? key, null, false);
  }

  return out;
}

const toNumber = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

export type ItemVariantGroupTotals = {
  qtyOnHand: number;
  reservedQty: number;
  available: number;
  avgCost: number;
  totalValue: number;
};

export type ItemVariantGroup = {
  itemId: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  uomCode: string;
  sellingPrice: number | null;
  /** Rows that survive the search. */
  rows: ItemVariantListRow[];
  /** Every row of the product, before the search. */
  variantCount: number;
  /** Summed over every row of the product, before the search, so they equal the per-product view. */
  totals: ItemVariantGroupTotals;
  /** Exactly one row before the search, and it is the `""` bucket. */
  variantless: boolean;
};

/**
 * One group per item, in input order, holding that item's rows after the search. Items with no
 * surviving row are left out. Variant count, totals and the variantless flag read every row, so a
 * search narrows what is listed without changing what the product header says.
 */
export function buildVariantGroups(
  items: VariantRowItem[],
  inventory: VariantRowInventory[],
  search: string,
): ItemVariantGroup[] {
  const needle = search.trim().toLowerCase();
  const rowsByItem = new Map<string, ItemVariantListRow[]>();
  for (const row of buildVariantRows(items, inventory, "")) {
    const list = rowsByItem.get(row.itemId) ?? [];
    list.push(row);
    rowsByItem.set(row.itemId, list);
  }

  const groups: ItemVariantGroup[] = [];
  for (const item of items) {
    const all = rowsByItem.get(item.id) ?? [];
    const rows = all.filter((row) => rowMatchesSearch(needle, item, row));
    if (rows.length === 0) continue;

    const qtyOnHand = all.reduce((sum, r) => sum + r.qtyOnHand, 0);
    const reservedQty = all.reduce((sum, r) => sum + r.reservedQty, 0);
    const totalValue = all.reduce((sum, r) => sum + r.totalValue, 0);
    groups.push({
      itemId: item.id,
      sku: item.sku,
      nameId: item.nameId,
      nameEn: item.nameEn,
      type: item.type,
      uomCode: item.uomCode,
      sellingPrice: item.sellingPrice,
      rows,
      variantCount: all.length,
      totals: {
        qtyOnHand,
        reservedQty,
        available: qtyOnHand - reservedQty,
        avgCost: qtyOnHand > 0 ? totalValue / qtyOnHand : 0,
        totalValue,
      },
      variantless: all.length === 1 && all[0].variantSku === "",
    });
  }
  return groups;
}

async function loadVariantRowSources(
  filters: ListItemsFilters,
): Promise<{ items: VariantRowItem[]; inventory: VariantRowInventory[] }> {
  const rows = await prisma.item.findMany({
    where: buildItemsWhere({ ...filters, search: undefined }),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      type: true,
      variants: true,
      sellingPrice: true,
      uom: { select: { code: true } },
    },
  });
  if (rows.length === 0) return { items: [], inventory: [] };

  const inventory = await prisma.inventoryValue.findMany({
    where: { itemId: { in: rows.map((i) => i.id) } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true },
  });

  return {
    items: rows.map((i) => ({
      id: i.id,
      sku: i.sku,
      nameId: i.nameId,
      nameEn: i.nameEn,
      type: i.type,
      uomCode: i.uom.code,
      sellingPrice: i.sellingPrice === null ? null : toNumber(i.sellingPrice),
      variants: i.variants,
    })),
    inventory: inventory.map((r) => ({
      itemId: r.itemId,
      variantSku: r.variantSku,
      qtyOnHand: toNumber(r.qtyOnHand),
      reservedQty: toNumber(r.reservedQty),
      totalValue: toNumber(r.totalValue),
    })),
  };
}

/**
 * Variant SKUs live inside `Item.variants` JSON, so search cannot run in SQL: every item
 * matching the type/active filters is loaded with its inventory, grouped by product, filtered
 * and paged in memory — a page is a page of products, never a slice through one. Fine at the
 * current catalog size (about a thousand variants); revisit before it grows by an order of magnitude.
 */
export async function listItemVariantGroups(
  filters: ListItemsFilters,
  opts: ListItemsOpts,
): Promise<{ groups: ItemVariantGroup[]; totalCount: number }> {
  const { items, inventory } = await loadVariantRowSources(filters);
  if (items.length === 0) return { groups: [], totalCount: 0 };

  const groups = buildVariantGroups(items, inventory, filters.search ?? "");
  const start = (opts.page - 1) * opts.pageSize;
  return { groups: groups.slice(start, start + opts.pageSize), totalCount: groups.length };
}
