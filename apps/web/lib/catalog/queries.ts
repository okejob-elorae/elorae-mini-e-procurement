import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { sentItemIds } from "@/lib/field-sales/queries";

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
  inventoryValues: Array<{ qtyOnHand: unknown; reservedQty?: unknown; totalValue: unknown }>;
};

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

export function serializeCatalogItem(
  row: CatalogRow,
  store: { termsType: "PUTUS" | "KONSI"; marginPercent: number | null },
  imageUrl: string | null,
  neverSent: boolean,
): CatalogItem {
  const inv = aggregateInventoryValues(row.inventoryValues);
  const { price, label } = computeStorePrice({
    sellingPrice: toNum(row.sellingPrice),
    termsType: store.termsType,
    marginPercent: store.marginPercent,
  });
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
      inventoryValues: { select: { qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
  });

  const images = await getPrimaryImagesBatch(rows.map((r) => ({ itemId: r.id, variantSku: null })));
  const key = (itemId: string) => `${itemId}|`;

  const items = rows.map((r) =>
    serializeCatalogItem(r, storeCtx, images.get(key(r.id)) ?? null, storeCtx.termsType === "KONSI" ? !sentSet.has(r.id) : false),
  );

  return { store: storeCtx, items };
}
