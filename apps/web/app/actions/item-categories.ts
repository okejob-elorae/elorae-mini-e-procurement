'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { listItemCategories, listItemCategoriesWithUsage } from '@/lib/item-categories/queries';
import {
  createItemCategoryRecord,
  updateItemCategoryRecord,
  deleteItemCategoryRecord,
  ItemCategoryError,
} from '@/lib/item-categories/mutations';

/**
 * Hasil tulis untuk layar kelola kategori: kode, bukan lemparan — pesan galat
 * aksi server disamarkan jadi digest di produksi.
 */
export type HasilKategori =
  | { ok: true }
  | { ok: false; code: 'DUPLICATE_CODE' | 'IN_USE' | 'FAILED'; count?: number };

function keHasil(e: unknown): HasilKategori {
  if (e instanceof ItemCategoryError) return { ok: false, code: e.code, count: e.count };
  // Kode kategori unik di basis data.
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
    return { ok: false, code: 'DUPLICATE_CODE' };
  }
  console.error(e);
  return { ok: false, code: 'FAILED' };
}

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

export async function getItemCategoriesWithUsage() {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  return listItemCategoriesWithUsage();
}

export async function createItemCategory(data: {
  name: string;
  code?: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<HasilKategori> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE);
  try {
    await createItemCategoryRecord(data);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
  return { ok: true };
}

export async function updateItemCategory(
  id: string,
  data: {
    name: string;
    code?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
): Promise<HasilKategori> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);
  try {
    await updateItemCategoryRecord(id, data);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
  return { ok: true };
}

export async function deleteItemCategory(id: string): Promise<HasilKategori> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_DELETE);
  try {
    await deleteItemCategoryRecord(id);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/items');
  revalidatePath('/backoffice/items/categories');
  return { ok: true };
}
