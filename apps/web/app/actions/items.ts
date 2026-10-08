'use server';

import { revalidatePath } from 'next/cache';
import { ItemType, prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { generateSKU as generateSKUFromLib } from '@/lib/sku-generator';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { getActorName, notifyItemCreated } from '@/app/actions/notifications';
import {
  getConsumptionRules as getConsumptionRulesFromLib,
  saveConsumptionRules as saveConsumptionRulesFromLib,
} from '@/lib/production/consumption';
import {
  listItems,
  getItemCounts as getItemCountsLib,
  getItemById as getItemByIdLib,
  getItemsByType as getItemsByTypeLib,
  getFinishedGoodsWithBOM as getFinishedGoodsWithBOMLib,
  type ListItemsFilters,
  type ListItemsOpts,
} from '@/lib/items/queries';
import {
  createItem as createItemLib,
  updateItem as updateItemLib,
  deleteItem as deleteItemLib,
  ITEM_DELETE_BLOCKED,
  type ItemFormData,
  type SerializedItem,
} from '@/lib/items/mutations';
import {
  enqueueProductPushOnCreate,
  enqueueProductPushOnUpdate,
} from '@/app/actions/jubelio-product-push';
import {
  parseVariantBarcodeFormat,
  VARIANT_BARCODE_FORMAT_KEY,
  type VariantBarcodeFormatConfig,
} from '@/lib/items/variant-barcode';

export async function getVariantBarcodeFormatConfig(): Promise<VariantBarcodeFormatConfig> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  const row = await prisma.systemSetting.findUnique({
    where: { key: VARIANT_BARCODE_FORMAT_KEY },
    select: { value: true },
  });
  return parseVariantBarcodeFormat(row?.value);
}

export async function generateSKU(type: ItemType) {
  await requireSession();
  return generateSKUFromLib(type);
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }
  return session;
}

export async function createItem(data: ItemFormData) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE);

  const { item, serialized } = await createItemLib(data);

  getActorName(session.user.id)
    .then((triggeredByName) =>
      notifyItemCreated(item.id, item.nameEn || item.nameId || item.sku, triggeredByName)
    )
    .catch(() => {});

  enqueueProductPushOnCreate(item.id).catch(() => {});

  revalidatePath('/backoffice/items');
  return serialized;
}

export async function updateItem(id: string, data: ItemFormData) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  // Harga jual diisi MANUAL oleh pemilik (keputusan pemilik 2026-10-08): tidak
  // ada lagi harga yang dihitung dari margin. Perubahan harga manual dicatat di
  // riwayat harga dan ikut terkirim ke Jubelio lewat push produk di bawah.
  // Items with many variants/consumption rules push updateItemLib past Prisma's
  // 5s default. 15s gives headroom.
  const updated = await prisma.$transaction(async (tx) => {
    const hasil = await updateItemLib(tx, id, data, { olehUserId: session.user.id });
    const hargaLama = hasil.before.sellingPrice;
    const hargaBaru = hasil.after.sellingPrice;
    if (hargaLama !== hargaBaru) {
      await tx.itemPriceChangeLog.create({
        data: {
          itemId: id,
          oldSellingPrice: hargaLama,
          newSellingPrice: hargaBaru,
          oldAvgCost: null,
          newAvgCost: null,
          marginPercentUsed: null,
          additionalCostUsed: null,
          triggerReason: "MANUAL_EDIT",
          fgReceiptId: null,
          changedById: session.user.id,
        },
      });
    }
    return hasil;
  }, { timeout: 15000 });

  enqueueProductPushOnUpdate(id, updated.before, updated.after).catch(() => {});

  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return updated.serialized;
}

export type DeleteItemActionResult =
  | { success: true }
  | { success: false; messageKey: "cannotDeleteItemInUse" | "failedToDeleteItem" };

export async function deleteItem(id: string): Promise<DeleteItemActionResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_DELETE);

  try {
    await deleteItemLib(id);
    revalidatePath("/backoffice/items");
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === ITEM_DELETE_BLOCKED) {
      return { success: false, messageKey: "cannotDeleteItemInUse" };
    }
    return { success: false, messageKey: "failedToDeleteItem" };
  }
}

export async function getItems(filters?: ListItemsFilters, opts?: ListItemsOpts) {
  await requireSession();
  return listItems(filters, opts);
}

export async function getItemCounts() {
  await requireSession();
  return getItemCountsLib();
}

export async function getItemById(id: string) {
  await requireSession();
  return getItemByIdLib(id);
}

export async function getItemsByType(type: ItemType) {
  await requireSession();
  return getItemsByTypeLib(type);
}

export async function getFinishedGoodsWithBOM() {
  await requireSession();
  return getFinishedGoodsWithBOMLib();
}

export async function getConsumptionRules(finishedGoodId: string) {
  await requireSession();
  return getConsumptionRulesFromLib(finishedGoodId);
}

export async function saveConsumptionRules(
  finishedGoodId: string,
  rules: Array<{
    materialId: string;
    qtyRequired: number;
    wastePercent: number;
    notes?: string;
  }>
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  const result = await saveConsumptionRulesFromLib(finishedGoodId, rules);
  revalidatePath(`/backoffice/items/${finishedGoodId}`);
  return result;
}
