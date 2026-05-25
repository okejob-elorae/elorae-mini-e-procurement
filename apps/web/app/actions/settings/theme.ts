'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@elorae/db';
import { listPantoneColors, type ListPantoneFilters } from '@/lib/production-colors/queries';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export type UserThemePreference = {
  pantoneTcx: string | null;
  primaryHex: string;
  pantoneName?: string | null;
};

export type PantoneThemeSwatch = {
  tcx: string;
  name: string;
  hex: string;
  groupName?: string | null;
};

function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error('Invalid color format. Use 6-digit hex color.');
  }
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return withHash.toLowerCase();
}

export async function getUserThemePreference(): Promise<UserThemePreference> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      themePantoneTcx: true,
      themePrimaryHex: true,
      themePantone: { select: { name: true } },
    },
  });

  return {
    pantoneTcx: user?.themePantoneTcx ?? null,
    primaryHex: user?.themePrimaryHex ?? DEFAULT_THEME_PRIMARY_COLOR,
    pantoneName: user?.themePantone?.name ?? null,
  };
}

export async function listPantoneColorsForTheme(
  search: string,
  page = 1
): Promise<{ colors: PantoneThemeSwatch[]; totalPages: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const filters: ListPantoneFilters = { search: search.trim() || undefined };
  const { colors, totalCount } = await listPantoneColors(filters, { page, pageSize: 48 });
  const totalPages = Math.ceil(totalCount / 48) || 1;

  return {
    colors: colors.map((c) => ({
      tcx: c.tcx,
      name: c.name,
      hex: c.hex.startsWith('#') ? c.hex.toLowerCase() : `#${c.hex.toLowerCase()}`,
      groupName: c.groupName,
    })),
    totalPages,
  };
}

export async function setUserThemePreference(
  preference: { tcx: string } | { reset: true }
): Promise<UserThemePreference> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  if ('reset' in preference) {
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        themePantoneTcx: null,
        themePrimaryHex: DEFAULT_THEME_PRIMARY_COLOR,
      },
      select: {
        themePantoneTcx: true,
        themePrimaryHex: true,
        themePantone: { select: { name: true } },
      },
    });

    revalidatePath('/backoffice/settings');

    return {
      pantoneTcx: updated.themePantoneTcx,
      primaryHex: updated.themePrimaryHex,
      pantoneName: updated.themePantone?.name ?? null,
    };
  }

  const tcx = preference.tcx.trim();
  if (!tcx) {
    throw new Error('Pantone TCX is required.');
  }

  const pantone = await prisma.pantoneColor.findUnique({
    where: { tcx },
    select: { tcx: true, hex: true, name: true },
  });

  if (!pantone) {
    throw new Error('Pantone color not found.');
  }

  const primaryHex = normalizeHexColor(pantone.hex);

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      themePantoneTcx: pantone.tcx,
      themePrimaryHex: primaryHex,
    },
    select: {
      themePantoneTcx: true,
      themePrimaryHex: true,
      themePantone: { select: { name: true } },
    },
  });

  revalidatePath('/backoffice/settings');

  return {
    pantoneTcx: updated.themePantoneTcx,
    primaryHex: updated.themePrimaryHex,
    pantoneName: updated.themePantone?.name ?? pantone.name,
  };
}
