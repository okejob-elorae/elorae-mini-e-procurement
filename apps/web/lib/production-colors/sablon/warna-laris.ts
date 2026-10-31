import { kenaliWarna, type KeluargaWarnaLokal } from './nama-warna';

/**
 * Warna yang laku di toko — dari riwayat penjualan marketplace (Shopee/TikTok
 * lewat Forecast → Import). Nama warna varian adalah warna PRODUKNYA, jadi ini
 * menjawab "kaos warna apa yang dibeli pelanggan kita", dan menjadi sumber
 * warna kain maupun aksen yang disukai pembeli.
 */

/** Jumlah terjual bersih per nama warna varian, 90 hari terakhir (`kini`) dan 90 hari sebelumnya (`lalu`). */
export type BarisPenjualanWarna = { nama: string | null; kategori: string | null; kini: number; lalu: number };

export type WarnaLaris = {
  kunci: string;
  label: string;
  hex: string;
  keluarga: KeluargaWarnaLokal | null;
  /** Terjual 90 hari terakhir. */
  qty: number;
  /** Bagian dari seluruh penjualan berwarna, 0–1. */
  bagian: number;
  /** Perubahan terhadap 90 hari sebelumnya (0,5 = naik 50%); `null` kalau sebelumnya belum terjual. */
  tren: number | null;
  /** Nama-nama varian yang tergabung di warna ini. */
  namaAsli: string[];
};

export type HasilWarnaLaris = { laris: WarnaLaris[]; tidakDikenal: { nama: string; qty: number }[]; total: number };

export function hitungWarnaLaris(
  baris: readonly BarisPenjualanWarna[],
  opsi: { manual?: Readonly<Record<string, string>>; kategori?: string | null } = {},
): HasilWarnaLaris {
  const disaring = baris.filter((b) => b.nama && b.nama.trim() && (!opsi.kategori || b.kategori === opsi.kategori));
  const total = disaring.reduce((s, b) => s + Math.max(0, b.kini), 0);

  const kelompok = new Map<string, WarnaLaris & { lalu: number }>();
  const asing = new Map<string, { nama: string; qty: number }>();
  for (const b of disaring) {
    const dikenal = kenaliWarna(b.nama, opsi.manual);
    if (!dikenal) {
      const ada = asing.get(b.nama!.trim().toLowerCase());
      if (ada) ada.qty += Math.max(0, b.kini);
      else asing.set(b.nama!.trim().toLowerCase(), { nama: b.nama!.trim(), qty: Math.max(0, b.kini) });
      continue;
    }
    const ada = kelompok.get(dikenal.kunci);
    if (ada) {
      ada.qty += Math.max(0, b.kini);
      ada.lalu += Math.max(0, b.lalu);
      if (!ada.namaAsli.includes(b.nama!)) ada.namaAsli.push(b.nama!);
    } else {
      kelompok.set(dikenal.kunci, { ...dikenal, qty: Math.max(0, b.kini), lalu: Math.max(0, b.lalu), bagian: 0, tren: null, namaAsli: [b.nama!] });
    }
  }

  const laris = [...kelompok.values()]
    .filter((w) => w.qty + w.lalu > 0)
    .map(({ lalu, ...w }) => ({ ...w, bagian: total > 0 ? w.qty / total : 0, tren: lalu > 0 ? w.qty / lalu - 1 : null }))
    .sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label));
  const tidakDikenal = [...asing.values()].filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama));
  return { laris, tidakDikenal, total };
}

export function daftarKategori(baris: readonly BarisPenjualanWarna[]): string[] {
  return [...new Set(baris.flatMap((b) => (b.kategori && b.kategori.trim() ? [b.kategori] : [])))].sort((a, b) => a.localeCompare(b));
}
