'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@elorae/db';
import { listPantoneColors, type ListPantoneFilters } from '@/lib/production-colors/queries';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';
import { FONT_BAWAAN, fontDikenal } from '@/lib/theme/fonts';
import {
  bacaWarnaPerusahaan,
  KUNCI_WARNA_PERUSAHAAN,
  tentukanWarnaTema,
  type WarnaEfektif,
  type WarnaTersimpan,
} from '@/lib/theme/warna-efektif';

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export type UserThemePreference = {
  /** Warna PRIBADI orang ini — yang disunting di layar pengaturan. */
  pantoneTcx: string | null;
  primaryHex: string;
  pantoneName?: string | null;
  /** Warna yang benar-benar dipakai: pribadi → perusahaan → bawaan. */
  efektif: WarnaEfektif;
  perusahaan: WarnaTersimpan | null;
};

const PILIH_WARNA_USER = {
  themePantoneTcx: true,
  themePrimaryHex: true,
  themePantone: { select: { name: true } },
} as const;

async function bacaPerusahaan(): Promise<WarnaTersimpan | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: KUNCI_WARNA_PERUSAHAAN },
    select: { value: true },
  });
  return bacaWarnaPerusahaan(row?.value);
}

async function bentukPreferensi(
  user: { themePantoneTcx: string | null; themePrimaryHex: string; themePantone: { name: string } | null } | null,
  namaCadangan?: string | null,
): Promise<UserThemePreference> {
  const perusahaan = await bacaPerusahaan();
  const primaryHex = user?.themePrimaryHex ?? DEFAULT_THEME_PRIMARY_COLOR;
  const pantoneName = user?.themePantone?.name ?? namaCadangan ?? null;
  return {
    pantoneTcx: user?.themePantoneTcx ?? null,
    primaryHex,
    pantoneName,
    efektif: tentukanWarnaTema({ hex: primaryHex, tcx: user?.themePantoneTcx, name: pantoneName }, perusahaan),
    perusahaan,
  };
}

/** Semua halaman yang menampilkan pemilih warna. */
function segarkanHalamanTema() {
  revalidatePath('/backoffice/settings');
  revalidatePath('/pwa/tampilan');
}

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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PILIH_WARNA_USER,
  });
  return bentukPreferensi(user);
}

export async function listPantoneColorsForTheme(
  search: string,
  page = 1
): Promise<{ colors: PantoneThemeSwatch[]; totalPages: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  // Cukup login: buku Pantone adalah data rujukan, dan salesman kini memilih
  // warnanya sendiri dari aplikasi HP.

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
  preference: { tcx: string } | { hex: string } | { reset: true }
): Promise<UserThemePreference> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  // Cukup login. Aksi ini hanya menulis baris milik orang itu sendiri dan
  // masukannya divalidasi; dulu dikunci izin keamanan, sehingga praktis hanya
  // admin yang bisa punya warna sendiri.

  if ('reset' in preference) {
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        themePantoneTcx: null,
        themePrimaryHex: DEFAULT_THEME_PRIMARY_COLOR,
      },
      select: PILIH_WARNA_USER,
    });
    segarkanHalamanTema();
    return bentukPreferensi(updated);
  }

  /*
   * A palette that is not in the Pantone book still needs to persist across
   * devices, and the schema already allows it: themePrimaryHex is required,
   * themePantoneTcx is nullable. Clearing the TCX is the point — it records
   * that this accent has no Pantone identity rather than pretending it does.
   */
  if ('hex' in preference) {
    const primaryHex = normalizeHexColor(preference.hex);
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { themePantoneTcx: null, themePrimaryHex: primaryHex },
      select: PILIH_WARNA_USER,
    });
    segarkanHalamanTema();
    return bentukPreferensi(updated);
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
    select: PILIH_WARNA_USER,
  });
  segarkanHalamanTema();
  return bentukPreferensi(updated, pantone.name);
}

/**
 * Warna perusahaan: bawaan untuk setiap orang yang belum memilih warnanya
 * sendiri — terutama aplikasi HP salesman dan SPG. Dijaga izin yang sama dengan
 * kartu tema selama ini, jadi tidak ada izin baru yang perlu di-seed.
 */
export async function setCompanyThemeColor(
  pilihan: { tcx: string } | { hex: string; name?: string | null } | { reset: true },
): Promise<{ perusahaan: WarnaTersimpan | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  if ('reset' in pilihan) {
    await prisma.systemSetting.deleteMany({ where: { key: KUNCI_WARNA_PERUSAHAAN } });
    segarkanHalamanTema();
    return { perusahaan: null };
  }

  let warna: WarnaTersimpan;
  if ('tcx' in pilihan) {
    const pantone = await prisma.pantoneColor.findUnique({
      where: { tcx: pilihan.tcx.trim() },
      select: { tcx: true, hex: true, name: true },
    });
    if (!pantone) throw new Error('Pantone color not found.');
    warna = { hex: normalizeHexColor(pantone.hex), tcx: pantone.tcx, name: pantone.name };
  } else {
    warna = { hex: normalizeHexColor(pilihan.hex), tcx: null, name: pilihan.name ?? null };
  }

  const value = JSON.stringify(warna);
  await prisma.systemSetting.upsert({
    where: { key: KUNCI_WARNA_PERUSAHAAN },
    create: { key: KUNCI_WARNA_PERUSAHAAN, value },
    update: { value },
  });
  segarkanHalamanTema();
  return { perusahaan: warna };
}

/**
 * Huruf pilihan pengguna.
 *
 * Terpisah dari `setUserThemePreference` dengan sengaja: mengganti huruf tidak
 * boleh menuntut warna ikut dikirim ulang, dan sebaliknya. Keduanya memang
 * "tema", tapi orang mengubahnya di saat yang berbeda.
 */
export async function setUserFont(fontId: string): Promise<{ ok: boolean; fontId: string }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  /*
   * Divalidasi terhadap daftar SEBELUM disimpan. Id yang tidak dikenal akan
   * diam-diam jatuh ke bawaan setiap kali dibaca — pengguna memilih sesuatu,
   * tampilannya tidak berubah, dan tidak ada yang menjelaskan kenapa.
   */
  if (!fontDikenal(fontId)) return { ok: false, fontId: FONT_BAWAAN };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { themeFontId: fontId },
  });
  revalidatePath('/backoffice/settings');
  return { ok: true, fontId };
}

export async function getUserFont(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) return FONT_BAWAAN;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { themeFontId: true },
  });
  // Yang tersimpan tapi sudah tidak ada di daftar jatuh ke bawaan, bukan kosong.
  return u?.themeFontId && fontDikenal(u.themeFontId) ? u.themeFontId : FONT_BAWAAN;
}
