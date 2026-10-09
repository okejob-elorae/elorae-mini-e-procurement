"use server";

import { auth } from "@/lib/auth";
import { listPantoneColors } from "@/lib/production-colors/queries";
import { normalHex, RONA_PANTONE, type RonaPantone, type WarnaPantone } from "@/lib/tampilan/warna-pilihan";
import { pantoneFavorit, pantonePerRona, spektrumPantone } from "@/lib/tampilan/warna-pantone-queries";

/**
 * Pemilih warna Pantone (jenis pemasok, grafik beranda). Cukup login: katalog Pantone adalah data
 * rujukan, sama dengan pemilih warna tema (`listPantoneColorsForTheme`).
 */

// 32 = empat baris penuh di kisi 8 kolom.
const PER_HALAMAN = 32;

export type HasilCariPantone = { warna: WarnaPantone[]; halaman: number; adaLagi: boolean };

export async function cariPantoneWarnaAction(input: { cari?: string; rona?: RonaPantone | null; halaman?: number }): Promise<HasilCariPantone> {
  const sesi = await auth();
  if (!sesi?.user?.id) return { warna: [], halaman: 1, adaLagi: false };
  const halaman = Math.max(1, Math.floor(Number(input?.halaman) || 1));
  const cari = typeof input?.cari === "string" ? input.cari.trim().slice(0, 60) : "";
  const rona = RONA_PANTONE.find((r) => r.kunci === input?.rona);
  if (rona && !cari) {
    // Hanya rona: yang paling jelas warnanya dulu, bukan urutan buku (yang dimulai dari putih).
    const { warna, total } = await pantonePerRona(rona.tag, halaman, PER_HALAMAN);
    return { warna, halaman, adaLagi: halaman * PER_HALAMAN < total };
  }
  const { colors, totalCount } = await listPantoneColors(
    { search: cari || undefined, hue: rona ? [rona.tag] : undefined },
    { page: halaman, pageSize: PER_HALAMAN },
  );
  const warna: WarnaPantone[] = [];
  for (const c of colors) {
    const hex = normalHex(c.hex);
    if (hex) warna.push({ tcx: c.tcx, nama: c.name, hex });
  }
  return { warna, halaman, adaLagi: halaman * PER_HALAMAN < totalCount };
}

export async function pantoneFavoritSayaAction(): Promise<WarnaPantone[]> {
  const sesi = await auth();
  if (!sesi?.user?.id) return [];
  return pantoneFavorit(sesi.user.id);
}

/** Tampilan awal pemilih: satu baris per rona, terang ke gelap. */
export async function spektrumPantoneAction(): Promise<{ kunci: RonaPantone; warna: WarnaPantone[] }[]> {
  const sesi = await auth();
  if (!sesi?.user?.id) return [];
  return spektrumPantone();
}
