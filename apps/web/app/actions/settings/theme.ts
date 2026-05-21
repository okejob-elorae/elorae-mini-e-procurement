'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  ThemeBaseColorName,
  isAllowedThemeBaseColorName,
  isAllowedThemePrimaryColor,
} from '@/lib/theme/theme-presets';

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export type UserThemePreference = {
  baseColor: ThemeBaseColorName;
  primaryColor: string;
};

function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error('Invalid color format. Use 6-digit hex color.');
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const normalized = withHash.toLowerCase();
  if (!isAllowedThemePrimaryColor(normalized)) {
    throw new Error('Invalid theme color preset.');
  }
  return normalized;
}

function normalizeBaseColorName(value: string): ThemeBaseColorName {
  const normalized = value.trim().toLowerCase();
  if (!isAllowedThemeBaseColorName(normalized)) {
    throw new Error('Invalid base color preset.');
  }
  return normalized;
}

export async function getUserThemePreference(): Promise<UserThemePreference> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { themeBase: true, themePrimary: true },
  });

  return {
    baseColor: normalizeBaseColorName(user?.themeBase ?? DEFAULT_THEME_BASE_COLOR),
    primaryColor: user?.themePrimary ?? DEFAULT_THEME_PRIMARY_COLOR,
  };
}

export async function setUserThemePreference(
  preference: { baseColor: ThemeBaseColorName; primaryColor: string }
): Promise<UserThemePreference> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const normalizedBase = normalizeBaseColorName(preference.baseColor);
  const normalizedColor = normalizeHexColor(preference.primaryColor);

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { themeBase: normalizedBase, themePrimary: normalizedColor },
    select: { themeBase: true, themePrimary: true },
  });

  revalidatePath('/backoffice/settings');

  return {
    baseColor: normalizeBaseColorName(updated.themeBase ?? DEFAULT_THEME_BASE_COLOR),
    primaryColor: updated.themePrimary ?? DEFAULT_THEME_PRIMARY_COLOR,
  };
}
