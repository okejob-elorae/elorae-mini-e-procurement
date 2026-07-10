'use server';

import { revalidatePath } from 'next/cache';
import { ItemType, prisma, recalcItemSellingPrice } from '@elorae/db';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/internal-api';
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

  const txResult = await prisma.$transaction(async (tx) => {
    const beforeItem = await tx.item.findUnique({
      where: { id },
      select: {
        targetMarginPercent: true,
        additionalCost: true,
        sellingPrice: true,
      },
    });
    if (!beforeItem) throw new Error("Item not found");
    // Items with many variants/consumption rules push updateItemLib past Prisma's
    // 5s default; helper adds a few more ops on top. 15s gives headroom.

    const updated = await updateItemLib(tx, id, data);

    const toNumOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
    const beforeMargin = toNumOrNull(beforeItem.targetMarginPercent);
    const afterMargin = toNumOrNull(data.targetMarginPercent);
    const beforeExtras = toNumOrNull(beforeItem.additionalCost);
    const afterExtras = toNumOrNull(data.additionalCost);
    const beforeSelling = toNumOrNull(beforeItem.sellingPrice);
    const afterSelling = toNumOrNull(data.sellingPrice);

    const marginChanged = beforeMargin !== afterMargin;
    const extrasChanged = beforeExtras !== afterExtras;
    const sellingPriceChanged = beforeSelling !== afterSelling;

    let outboxRowId: string | null = null;

    if (marginChanged || extrasChanged) {
      const recalc = await recalcItemSellingPrice(tx, {
        itemId: id,
        trigger: "MARGIN_CHANGE",
        changedById: session.user.id,
      });
      if (recalc.applied) {
        outboxRowId = recalc.outboxRowId;
      }
    } else if (sellingPriceChanged) {
      await tx.itemPriceChangeLog.create({
        data: {
          itemId: id,
          oldSellingPrice: beforeSelling,
          newSellingPrice: afterSelling,
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

    return { updated, outboxRowId };
  }, { timeout: 15000 });

  if (txResult.outboxRowId) {
    void apiFetch("POST", `/jubelio/outbox/enqueue/${txResult.outboxRowId}`, {
      userId: session.user.id,
    }).catch(() => {});
  } else {
    enqueueProductPushOnUpdate(id, txResult.updated.before, txResult.updated.after).catch(() => {});
  }

  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return txResult.updated.serialized;
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
