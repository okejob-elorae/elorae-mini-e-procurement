'use server';

import { revalidatePath } from 'next/cache';
import { ItemType } from '@prisma/client';
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
  type ItemFormData,
  type SerializedItem,
} from '@/lib/items/mutations';

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

  revalidatePath('/backoffice/items');
  return serialized;
}

export async function updateItem(id: string, data: ItemFormData) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  const result = await updateItemLib(id, data);
  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return result;
}

export async function deleteItem(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_DELETE);

  await deleteItemLib(id);
  revalidatePath('/backoffice/items');
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
