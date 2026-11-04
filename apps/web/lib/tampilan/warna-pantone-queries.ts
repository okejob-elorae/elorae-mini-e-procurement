import { prisma } from "@elorae/db";
import { contohSpektrum, normalHex, normalTcx, urutRona, type BarisSpektrum, type RonaPantone, type WarnaPantone } from "./warna-pilihan";

/**
 * Katalog Pantone TCX untuk warna pilihan — KHUSUS SERVER (klien hanya `import type`).
 * Hex selalu diambil dari sini; kode yang tidak ada di katalog tidak pernah disimpan.
 */

function keWarna(row: { tcx: string; name: string; hex: string }): WarnaPantone | null {
  const hex = normalHex(row.hex);
  return hex ? { tcx: row.tcx, nama: row.name, hex } : null;
}

/** Kode TCX → warnanya di katalog (yang tidak dikenal dilewati). */
export async function ambilPantone(kode: readonly string[]): Promise<Map<string, WarnaPantone>> {
  const tcx = [...new Set(kode.map((k) => normalTcx(k)).filter((k): k is string => Boolean(k)))];
  if (!tcx.length) return new Map();
  const rows = await prisma.pantoneColor.findMany({ where: { tcx: { in: tcx } }, select: { tcx: true, name: true, hex: true } });
  const hasil = new Map<string, WarnaPantone>();
  for (const r of rows) {
    const w = keWarna(r);
    if (w) hasil.set(r.tcx, w);
  }
  return hasil;
}

/** Pantone favorit orang ini (dari Palet Warna), terbaru dulu. */
export async function pantoneFavorit(userId: string, batas = 30): Promise<WarnaPantone[]> {
  const fav = await prisma.pantoneColorFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: batas,
    select: { color: { select: { tcx: true, name: true, hex: true } } },
  });
  return fav.map((f) => keWarna(f.color)).filter((w): w is WarnaPantone => w !== null);
}

// Katalog Pantone hanya diisi seed (±2.800 baris); dibaca sekali per proses untuk spektrum dan
// urutan per rona, yang membutuhkan nilai Lab seluruh katalog.
let katalogTersimpan: Promise<BarisSpektrum[]> | null = null;

function katalogPantone(): Promise<BarisSpektrum[]> {
  katalogTersimpan ??= prisma.pantoneColor
    .findMany({ select: { tcx: true, name: true, hex: true, filterTags: true, labL: true, labA: true, labB: true } })
    .then((rows) =>
      rows.map((r) => {
        const tag = (r.filterTags as { hue?: unknown } | null)?.hue;
        return {
          tcx: r.tcx,
          nama: r.name,
          hex: r.hex,
          rona: Array.isArray(tag) ? tag.filter((t): t is string => typeof t === "string") : [],
          L: r.labL,
          C: r.labA != null && r.labB != null ? Math.hypot(r.labA, r.labB) : null,
        };
      }),
    )
    .catch((e) => {
      katalogTersimpan = null;
      throw e;
    });
  return katalogTersimpan;
}

/** Tampilan awal pemilih warna: 8 warna per rona dari terang ke gelap (lihat `contohSpektrum`). */
export async function spektrumPantone(): Promise<{ kunci: RonaPantone; warna: WarnaPantone[] }[]> {
  return contohSpektrum(await katalogPantone(), 8);
}

/** Satu halaman warna sebuah rona, yang paling jelas warnanya dulu (lihat `urutRona`). */
export async function pantonePerRona(tag: string, halaman: number, perHalaman: number): Promise<{ warna: WarnaPantone[]; total: number }> {
  const semua = urutRona(await katalogPantone(), tag, perHalaman);
  return { warna: semua.slice((halaman - 1) * perHalaman, halaman * perHalaman), total: semua.length };
}
