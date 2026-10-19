'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { colorMatchKey } from '@elorae/db/variant-axes';
import {
  listVariantColors,
  loadColorIndex,
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
    select: {
      id: true,
      name: true,
      aliases: { select: { label: true } },
      pantone: { select: { tcx: true, hex: true } },
    },
  });
  return colors.map(toColorOption);
}

export type VariantColorOption = {
  id: string;
  name: string;
  aliases: string[];
  pantone: { tcx: string; hex: string } | null;
};

function toColorOption(c: {
  id: string;
  name: string;
  aliases: { label: string }[];
  pantone: { tcx: string; hex: string } | null;
}): VariantColorOption {
  const hex = c.pantone?.hex;
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases.map((a) => a.label),
    pantone: c.pantone && hex ? { tcx: c.pantone.tcx, hex: hex.startsWith('#') ? hex : `#${hex}` } : null,
  };
}

/**
 * Add a colour from the item form: a name (typed by ops), a Pantone, or both. A name already
 * spelled by a colour, or a Pantone already linked to one, returns that colour instead of a twin.
 */
export async function addVariantColorFromItemForm(input: {
  name: string;
  pantoneTcx?: string | null;
  /** Spelling already on the item (an unmatched colour), kept as an alias so its variants resolve. */
  alias?: string | null;
}): Promise<{ ok: true; color: VariantColorOption } | { ok: false; error: string }> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);
  const pantoneTcx = input.pantoneTcx?.trim() || null;
  let name = input.name.trim();
  const select = {
    id: true,
    name: true,
    aliases: { select: { label: true } },
    pantone: { select: { tcx: true, hex: true } },
  } as const;

  const byPantone = pantoneTcx
    ? await prisma.variantColor.findFirst({ where: { pantoneTcx }, select })
    : null;
  if (byPantone) return { ok: true, color: toColorOption(byPantone) };
  if (!name && pantoneTcx) {
    name = (await prisma.pantoneColor.findUnique({ where: { tcx: pantoneTcx }, select: { name: true } }))?.name ?? '';
  }
  const existingId = name ? (await loadColorIndex()).get(colorMatchKey(name)) : undefined;
  if (existingId) {
    const existing = await prisma.variantColor.findUniqueOrThrow({ where: { id: existingId }, select });
    return { ok: true, color: toColorOption(existing) };
  }

  try {
    const saved = await saveVariantColor(null, { name, pantoneTcx, aliases: input.alias ? [input.alias] : [] });
    revalidatePath('/backoffice/production/colors');
    const color = await prisma.variantColor.findUniqueOrThrow({ where: { id: saved.id }, select });
    return { ok: true, color: toColorOption(color) };
  } catch (err) {
    if (err instanceof VariantColorError) return { ok: false, error: err.message };
    throw err;
  }
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
