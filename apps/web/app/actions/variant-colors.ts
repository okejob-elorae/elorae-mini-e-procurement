'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  addColorFromItemForm,
  colorOptionSelect,
  listVariantColors,
  toColorOption,
  withHash,
  type AddColorInput,
  type AddColorResult,
  type VariantColorOption,
  saveVariantColor,
  VariantColorError,
  type VariantColorInput,
} from '@/lib/items/variant-colors';
import { listPantoneColors } from '@/lib/production-colors/queries';

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export async function getVariantColors() {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_COLORS_VIEW);
  return listVariantColors();
}

/** Active colours with their spellings and Pantone, for the finished-good Warna picker and BOM scopes. */
export async function getVariantColorOptions(): Promise<VariantColorOption[]> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  const colors = await prisma.variantColor.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: colorOptionSelect,
  });
  return colors.map(toColorOption);
}

/** Add a colour from the item form (name, Pantone, or both); see addColorFromItemForm. */
export async function addVariantColorFromItemForm(input: AddColorInput): Promise<AddColorResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);
  const result = await addColorFromItemForm(input);
  if (result.ok) revalidatePath('/backoffice/production/colors');
  return result;
}

/** Pantone swatches for the optional Pantone of a colour-specific material (#410). */
export async function getPantoneOptionsForItems(search: string, page = 1) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  const { colors, totalCount } = await listPantoneColors({ search: search.trim() || undefined }, { page, pageSize: 48 });
  return {
    colors: colors.map((c) => ({
      tcx: c.tcx,
      name: c.name,
      hex: withHash(c.hex.toLowerCase()),
      groupName: c.groupName,
    })),
    totalPages: Math.ceil(totalCount / 48) || 1,
  };
}

export async function saveVariantColorAction(
  id: string | null,
  input: VariantColorInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);
  try {
    const saved = await saveVariantColor(id, input);
    revalidatePath('/backoffice/production/colors');
    return { ok: true, id: saved.id };
  } catch (err) {
    if (err instanceof VariantColorError) return { ok: false, error: err.message };
    throw err;
  }
}
