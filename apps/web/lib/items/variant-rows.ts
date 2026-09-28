import { prisma } from "@elorae/db";
import type { ItemType } from "@/lib/constants/enums";
import { parseItemVariants } from "@/lib/items/variants";
import { aggregateInventoryValues, buildItemsWhere, type ListItemsFilters, type ListItemsOpts } from "@/lib/items/queries";

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

/**
 * The `(itemId, variantSku)` unique index sits on a case-insensitive collation, so the database
 * treats `ABC-01` and `abc-01` as one variant key; matching here does the same, or a catalog
 * variant shows zero while its real stock surfaces as an off-catalog row under another spelling.
 */
function matchKey(variantSku: string | null): string {
  return (variantSku ?? "").trim().toLowerCase();
}

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
    const itemMatches = needle !== "" && matchesSearch(needle, [item.sku, item.nameId, item.nameEn]);

    const pushRow = (variantSku: string, variant: CatalogVariant | null, inCatalog: boolean) => {
      if (needle !== "" && !itemMatches && !matchesSearch(needle, [variantSku, variant?.barcode ?? null])) return;
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

/**
 * Variant SKUs live inside `Item.variants` JSON, so search cannot run in SQL: every item
 * matching the type/active filters is loaded with its inventory, flattened, filtered and
 * paged in memory. Fine at the current catalog size (about a thousand variants); revisit
 * before it grows by an order of magnitude.
 */
export async function listItemVariantRows(
  filters: ListItemsFilters,
  opts: ListItemsOpts,
): Promise<{ rows: ItemVariantListRow[]; totalCount: number }> {
  const items = await prisma.item.findMany({
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
  if (items.length === 0) return { rows: [], totalCount: 0 };

  const inventory = await prisma.inventoryValue.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true },
  });

  const rows = buildVariantRows(
    items.map((i) => ({
      id: i.id,
      sku: i.sku,
      nameId: i.nameId,
      nameEn: i.nameEn,
      type: i.type,
      uomCode: i.uom.code,
      sellingPrice: i.sellingPrice === null ? null : toNumber(i.sellingPrice),
      variants: i.variants,
    })),
    inventory.map((r) => ({
      itemId: r.itemId,
      variantSku: r.variantSku,
      qtyOnHand: toNumber(r.qtyOnHand),
      reservedQty: toNumber(r.reservedQty),
      totalValue: toNumber(r.totalValue),
    })),
    filters.search ?? "",
  );

  const start = (opts.page - 1) * opts.pageSize;
  return { rows: rows.slice(start, start + opts.pageSize), totalCount: rows.length };
}
