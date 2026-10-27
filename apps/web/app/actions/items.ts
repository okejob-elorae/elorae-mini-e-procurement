'use server';

import { revalidatePath } from 'next/cache';
import { ItemType, prisma, recalcItemSellingPrice } from '@elorae/db';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/internal-api';
import { generateSKU as generateSKUFromLib } from '@/lib/sku-generator';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { notifyItemCreated } from '@/lib/notifications/events';
import { getActorName } from "@/lib/notifications/actor-name";
import {
  getConsumptionRules as getConsumptionRulesFromLib,
  saveConsumptionRules as saveConsumptionRulesFromLib,
  type ConsumptionRuleInput,
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
  getItemDeleteImpact as getItemDeleteImpactLib,
  ITEM_DELETE_BLOCKED,
  type ItemDeleteImpact,
  type ItemFormData,
  type SerializedItem,
} from '@/lib/items/mutations';
import {
  VariantBarcodeTakenError,
  VariantSkuTakenError,
} from "@/lib/items/variant-sku-collisions";
import {
  enqueueProductPushOnCreate,
  enqueueProductPushOnUpdate,
} from '@/lib/jubelio/product-push';
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

export type ItemSaveRefusal = {
  success: false;
  code: "VARIANT_SKU_TAKEN" | "VARIANT_BARCODE_TAKEN";
  detail: string;
};

export type ItemSaveResult = { success: true; item: SerializedItem } | ItemSaveRefusal;

function toItemSaveRefusal(error: unknown): ItemSaveRefusal | null {
  if (error instanceof VariantSkuTakenError) {
    return { success: false, code: "VARIANT_SKU_TAKEN", detail: error.skus.join(", ") };
  }
  if (error instanceof VariantBarcodeTakenError) {
    return { success: false, code: "VARIANT_BARCODE_TAKEN", detail: error.barcodes.join(", ") };
  }
  return null;
}

export async function createItem(data: ItemFormData): Promise<ItemSaveResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE);

  let created: Awaited<ReturnType<typeof createItemLib>>;
  try {
    created = await createItemLib(data);
  } catch (error) {
    const refusal = toItemSaveRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
  const { item, serialized } = created;

  getActorName(session.user.id)
    .then((triggeredByName) =>
      notifyItemCreated(item.id, item.nameEn || item.nameId || item.sku, triggeredByName)
    )
    .catch(() => {});

  enqueueProductPushOnCreate(item.id, session.user.id).catch(() => {});

  revalidatePath('/backoffice/items');
  return { success: true, item: serialized };
}

export async function updateItem(id: string, data: ItemFormData): Promise<ItemSaveResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  let txResult: Awaited<ReturnType<typeof runItemUpdate>>;
  try {
    txResult = await runItemUpdate(session.user.id, id, data);
  } catch (error) {
    const refusal = toItemSaveRefusal(error);
    if (refusal) return refusal;
    throw error;
  }

  if (txResult.outboxRowId) {
    void apiFetch("POST", `/jubelio/outbox/enqueue/${txResult.outboxRowId}`, {
      userId: session.user.id,
    }).catch(() => {});
  } else {
    enqueueProductPushOnUpdate(id, txResult.updated.before, txResult.updated.after, session.user.id).catch(() => {});
  }

  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return { success: true, item: txResult.updated.serialized };
}

async function runItemUpdate(userId: string, id: string, data: ItemFormData) {
  return prisma.$transaction(async (tx) => {
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
        changedById: userId,
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
          changedById: userId,
        },
      });
    }

    return { updated, outboxRowId };
  }, { timeout: 15000 });
}

export type DeleteItemActionResult =
  | { success: true }
  | { success: false; messageKey: "cannotDeleteItemInUse" | "failedToDeleteItem" };

export async function getItemDeleteImpactAction(id: string): Promise<ItemDeleteImpact> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_DELETE);
  return getItemDeleteImpactLib(id);
}

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
  rules: ConsumptionRuleInput[]
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  const result = await saveConsumptionRulesFromLib(finishedGoodId, rules);
  revalidatePath(`/backoffice/items/${finishedGoodId}`);
  return result;
}
