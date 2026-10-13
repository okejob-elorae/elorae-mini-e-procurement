"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requireAnyPermission } from "@/lib/rbac";
import { buildVariantRows } from "@/lib/items/variant-rows";
import { toVariantStockRecord, type VariantStock } from "@/lib/items/variant-stock";

/**
 * Main-warehouse stock per variant of a finished good, for the work order ratio rows. Keyed by
 * the catalog spelling of each variant SKU; `InventoryValue` is main warehouse only.
 */
export async function getFinishedGoodVariantStock(itemId: string): Promise<Record<string, VariantStock>> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  requireAnyPermission(session.user.permissions, [
    PERMISSIONS.WORK_ORDERS_CREATE,
    PERMISSIONS.WORK_ORDERS_MANAGE,
  ]);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
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
  if (!item) return {};

  const inventory = await prisma.inventoryValue.findMany({
    where: { itemId },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true },
  });

  const rows = buildVariantRows(
    [
      {
        id: item.id,
        sku: item.sku,
        nameId: item.nameId,
        nameEn: item.nameEn,
        type: item.type,
        uomCode: item.uom.code,
        sellingPrice: null,
        variants: item.variants,
      },
    ],
    inventory.map((r) => ({
      itemId: r.itemId,
      variantSku: r.variantSku,
      qtyOnHand: Number(r.qtyOnHand),
      reservedQty: Number(r.reservedQty),
      totalValue: Number(r.totalValue),
    })),
    "",
  );

  return toVariantStockRecord(rows);
}
