import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { sentItemIds } from "@/lib/field-sales/queries";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

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
  store: { id: string; termsType: "PUTUS" | "KONSI"; marginPercent: number | null };
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
  store: { termsType: "PUTUS" | "KONSI"; marginPercent: number | null },
  imageUrl: string | null,
  neverSent: boolean,
  globalMin: number,
): CatalogItem {
  const inv = aggregateInventoryValues(row.inventoryValues);
  // Konsi is a consignment transfer, not a sale: the salesman never sees pricing
  // (spec D6/D9). Keep the gross-up off the wire entirely, not just hidden in the UI.
  const isKonsi = store.termsType === "KONSI";
  const { price, label } = isKonsi
    ? { price: null, label: null }
    : computeStorePrice({
        sellingPrice: toNum(row.sellingPrice),
        termsType: store.termsType,
        marginPercent: store.marginPercent,
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
    select: { id: true, isActive: true, termsType: true, marginPercent: true },
  });
  if (!store || !store.isActive) return null;

  const storeCtx = {
    id: store.id,
    termsType: store.termsType,
    marginPercent: store.marginPercent ? store.marginPercent.toNumber() : null,
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
