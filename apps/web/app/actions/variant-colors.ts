'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  listVariantColors,
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

/** Active colours with their spellings, for resolving variant colours in the BOM editor. */
export async function getVariantColorOptions() {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);
  const colors = await prisma.variantColor.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, aliases: { select: { label: true } } },
  });
  return colors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases.map((a) => a.label) }));
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
      hex: c.hex.startsWith('#') ? c.hex.toLowerCase() : `#${c.hex.toLowerCase()}`,
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
