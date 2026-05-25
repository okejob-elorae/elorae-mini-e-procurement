'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { listItemCategories } from '@/lib/item-categories/queries';
import {
  createItemCategoryRecord,
  updateItemCategoryRecord,
  deleteItemCategoryRecord,
} from '@/lib/item-categories/mutations';

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export async function getItemCategories(activeOnly = false) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  return listItemCategories(activeOnly);
}

export async function createItemCategory(data: {
  name: string;
  code?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE);
  const row = await createItemCategoryRecord(data);
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
  return row;
}

export async function updateItemCategory(
  id: string,
  data: {
    name: string;
    code?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);
  const row = await updateItemCategoryRecord(id, data);
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
  return row;
}

export async function deleteItemCategory(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_DELETE);
  await deleteItemCategoryRecord(id);
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
}
