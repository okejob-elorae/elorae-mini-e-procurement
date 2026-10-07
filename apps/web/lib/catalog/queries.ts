import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { sentItemIds } from "@/lib/field-sales/queries";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { returVariantOptions, type ReturVariantOption } from "@/lib/field-sales/retur/variant-options";

export type CatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  available: number;
  price: number | null;
  priceLabel: string | null;
  neverSent: boolean;
  minOrderQty: number;
  variants: Array<{ variantSku: string; variantLabel: string; available: number }>;
};

export type CatalogPayload = {
  store: { id: string; termsType: "PUTUS" | "KONSI"; markupPercent: number | null; priceDiscountPercent: number | null };
  items: CatalogItem[];
};

type CatalogRow = {
  id: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  category: { name: string } | null;
  sellingPrice: unknown;
  minOrderQty: number | null;
  variants?: unknown;
  inventoryValues: Array<{ qtyOnHand: unknown; reservedQty?: unknown; totalValue: unknown; variantSku?: unknown }>;
};

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

export function serializeCatalogItem(
  row: CatalogRow,
  store: { termsType: "PUTUS" | "KONSI"; markupPercent: number | null; priceDiscountPercent: number | null },
  imageUrl: string | null,
  neverSent: boolean,
  globalMin: number,
): CatalogItem {
  const inv = aggregateInventoryValues(row.inventoryValues);
  /* Konsi is a consignment transfer, not a sale: the salesman never sees pricing. Keep the retail price off the wire entirely, not just hidden in the UI. */
  const isKonsi = store.termsType === "KONSI";
  const { price, label } = isKonsi
    ? { price: null, label: null }
    : computeStorePrice({
        sellingPrice: toNum(row.sellingPrice),
        termsType: store.termsType,
        markupPercent: store.markupPercent,
        priceDiscountPercent: store.priceDiscountPercent,
      });
  const labelBySku = new Map(
    variantSelectOptions(parseItemVariants(row.variants)).map((o) => [o.sku, o.label]),
  );
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const variants = row.inventoryValues
    .map((iv) => {
      const variantSku = (iv.variantSku as string | null) ?? "";
      return { variantSku, available: num(iv.qtyOnHand) - num(iv.reservedQty) };
    })
    // Only variant rows (real SKU) become sheet entries; the item-level null/"" bucket is the simple-item path.
    .filter((v) => v.variantSku !== "")
    .map((v) => ({ variantSku: v.variantSku, variantLabel: labelBySku.get(v.variantSku) ?? v.variantSku, available: v.available }))
    .sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
  return {
    itemId: row.id,
    sku: row.sku,
    nameId: row.nameId,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    primaryImageUrl: imageUrl,
    available: inv?.available ?? 0,
    price,
    priceLabel: label,
    neverSent,
    minOrderQty: row.minOrderQty ?? globalMin,
    variants,
  };
}

export async function listCatalogForPwa(storeId: string): Promise<CatalogPayload | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true, termsType: true, markupPercent: true, priceDiscountPercent: true },
  });
  if (!store || !store.isActive) return null;

  const storeCtx = {
    id: store.id,
    termsType: store.termsType,
    markupPercent: store.markupPercent ? store.markupPercent.toNumber() : null,
    priceDiscountPercent: store.priceDiscountPercent ? store.priceDiscountPercent.toNumber() : null,
  };

  const sentSet = store.termsType === "KONSI" ? await sentItemIds(store.id) : new Set<string>();

  const g = await prisma.systemSetting.findUnique({ where: { key: "putus.minOrderQty" } });
  const globalMin = g ? Number(g.value) : 6;

  const rows = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD" },
    orderBy: { nameId: "asc" },
    select: {
      id: true,
      sku: true,
      nameId: true,
      categoryId: true,
      category: { select: { name: true } },
      sellingPrice: true,
      minOrderQty: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
  });

  const images = await getPrimaryImagesBatch(rows.map((r) => ({ itemId: r.id, variantSku: null })));
  const key = (itemId: string) => `${itemId}|`;

  const items = rows.map((r) =>
    serializeCatalogItem(r, storeCtx, images.get(key(r.id)) ?? null, storeCtx.termsType === "KONSI" ? !sentSet.has(r.id) : false, globalMin),
  );

  return { store: storeCtx, items };
}

export type ReturCatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  variants: ReturVariantOption[];
};

/**
 * The retur picker's own catalog: a price-free list that keeps discontinued items, since a
 * discontinued item is exactly the "Tidak Laku"/"Kadaluarsa" case a store returns. The sell
 * catalog stays active-only; order lines are refused for inactive items by the writer. Each
 * item's variants are exactly the keys `createFieldReturn` accepts, the pooled `""` included.
 */
export async function listReturCatalogForPwa(storeId: string): Promise<{ items: ReturCatalogItem[] } | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true },
  });
  if (!store || !store.isActive) return null;

  const rows = await prisma.item.findMany({
    where: { type: "FINISHED_GOOD" },
    orderBy: { nameId: "asc" },
    select: {
      id: true,
      sku: true,
      nameId: true,
      categoryId: true,
      category: { select: { name: true } },
      variants: true,
      inventoryValues: { select: { variantSku: true } },
    },
  });

  const storeRows = await prisma.storeStock.findMany({
    where: { storeId: store.id },
    select: { itemId: true, variantSku: true },
  });
  const storeSkusByItem = new Map<string, string[]>();
  for (const r of storeRows) {
    const list = storeSkusByItem.get(r.itemId);
    if (list) list.push(r.variantSku);
    else storeSkusByItem.set(r.itemId, [r.variantSku]);
  }

  const images = await getPrimaryImagesBatch(rows.map((r) => ({ itemId: r.id, variantSku: null })));

  const items = rows.map((r) => ({
    itemId: r.id,
    sku: r.sku,
    nameId: r.nameId,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    primaryImageUrl: images.get(`${r.id}|`) ?? null,
    variants: returVariantOptions({
      variants: r.variants,
      inventorySkus: r.inventoryValues.map((v) => v.variantSku),
      storeStockSkus: storeSkusByItem.get(r.id) ?? [],
    }),
  }));

  return { items };
}
