"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requireAnyPermission } from "@/lib/rbac";
import { buildVariantRows } from "@/lib/items/variant-rows";
import { toVariantStockRecord, type VariantStock } from "@/lib/items/variant-stock";
import { colorMatchKey, resolveVariantAxes } from "@elorae/db/variant-axes";
import { loadColorIndex } from "@/lib/items/variant-colors";
import { parseItemVariants } from "@/lib/items/variants";
import type { VariantAxisRow } from "@/lib/work-orders/color-ratio";

/**
 * Main-warehouse stock per variant of a finished good, for the work order ratio rows. Keyed by
 * `matchKey` of each variant SKU (trimmed, lowercase); `InventoryValue` is main warehouse only.
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

/**
 * Each variant of a finished good with its colour and size, for picking a work order's colours
 * first and then their sizes (#410). A colour text the master does not know still groups by its
 * spelling, so the picker shows it; planning a colour-scoped BOM on it is refused elsewhere.
 */
export async function getFinishedGoodVariantAxes(itemId: string): Promise<VariantAxisRow[]> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  requireAnyPermission(session.user.permissions, [
    PERMISSIONS.WORK_ORDERS_CREATE,
    PERMISSIONS.WORK_ORDERS_MANAGE,
  ]);

  const [item, index] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId }, select: { variants: true } }),
    loadColorIndex(),
  ]);
  const variants = parseItemVariants(item?.variants).filter((v) => typeof v.sku === "string" && v.sku.trim());
  const resolved = variants.map((v) => ({ sku: String(v.sku).trim(), axes: resolveVariantAxes(v as Record<string, string>, index) }));
  const ids = [...new Set(resolved.map((r) => r.axes.colorId).filter((id): id is string => !!id))];
  const names = new Map(
    ids.length === 0
      ? []
      : (await prisma.variantColor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
          (c) => [c.id, c.name] as const,
        ),
  );
  return resolved.map(({ sku, axes }) => ({
    variantSku: sku,
    colorKey: axes.colorId ?? (axes.colorLabel ? `label:${colorMatchKey(axes.colorLabel)}` : "none"),
    colorName: (axes.colorId ? names.get(axes.colorId) : null) ?? axes.colorLabel ?? null,
    size: axes.size,
  }));
}
