'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  listPantoneColors,
  listFavoriteColors,
  getFavoriteTcxSet,
  toggleFavorite,
  countFavorites,
  type ListPantoneFilters,
  COLOR_PAGE_SIZE,
} from '@/lib/production-colors/queries';

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export async function getPantoneColorsList(
  filters: ListPantoneFilters,
  page = 1,
  pageSize = COLOR_PAGE_SIZE
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  return listPantoneColors(filters, { page, pageSize });
}

export async function getFavoritePantoneColorsList(
  filters: ListPantoneFilters,
  page = 1,
  pageSize = COLOR_PAGE_SIZE
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  return listFavoriteColors(session.user.id, filters, { page, pageSize });
}

export async function getFavoriteStatusForTcx(tcxCodes: string[]) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  const set = await getFavoriteTcxSet(session.user.id, tcxCodes);
  return Array.from(set);
}

export async function togglePantoneFavorite(tcx: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  const result = await toggleFavorite(session.user.id, tcx);
  revalidatePath('/backoffice/production/colors');
  revalidatePath('/backoffice/production/colors/favorites');
  return result;
}

export async function getFavoriteCount() {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  return countFavorites(session.user.id);
}
