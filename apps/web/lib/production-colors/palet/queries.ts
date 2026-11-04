import { prisma } from '@elorae/db';
import { JUMLAH_SABLON_MAKS, PORSI_AWAL } from '../sablon/saran';
import { ATURAN_HARMONI, JUMLAH_WARNA, type AturanHarmoni } from './harmoni';
import { normalisasiHex } from './warna';

export type BarisPalet = {
  id: string;
  nama: string;
  aturan: AturanHarmoni;
  warna: string[];
  /** Hex kain untuk palet sablon, `null` untuk palet bebas. */
  kain: string | null;
  porsi: number[] | null;
  dibuatOleh: string | null;
  dibuatPada: string;
};

/**
 * Palet tersimpan, terbaru dulu.
 *
 * Kolom `colors` adalah JSON: basis data tidak menjamin bentuknya. Baris yang
 * isinya bukan lima warna DILEWATI, bukan dilempar — satu baris rusak tidak
 * boleh mengosongkan seluruh halaman untuk semua orang.
 */
export async function daftarPalet(): Promise<BarisPalet[]> {
  const rows = await prisma.colorPalette.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      name: true,
      harmony: true,
      colors: true,
      fabricHex: true,
      portions: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });

  const hasil: BarisPalet[] = [];
  for (const r of rows) {
    const warna = Array.isArray(r.colors)
      ? r.colors.map((w) => (typeof w === 'string' ? normalisasiHex(w) : null))
      : [];
    const kain = r.fabricHex ? normalisasiHex(r.fabricHex) : null;
    const jumlahSah = kain ? warna.length >= 1 && warna.length <= JUMLAH_SABLON_MAKS : warna.length === JUMLAH_WARNA;
    if (!jumlahSah || warna.some((w) => w === null)) {
      console.warn(`Palet ${r.id} dilewati: kolom colors tidak sesuai bentuk paletnya.`);
      continue;
    }
    // Porsi yang rusak tidak menjatuhkan paletnya: warnanya tetap berguna, dan
    // porsi awal dipakai sebagai gantinya supaya lembar sablon tetap berjumlah 100.
    const porsiMentah = r.portions;
    const porsiSah =
      Array.isArray(porsiMentah) &&
      porsiMentah.length === warna.length &&
      porsiMentah.every((x) => Number.isInteger(x)) &&
      (porsiMentah as number[]).reduce((s, x) => s + x, 0) === 100;
    hasil.push({
      id: r.id,
      nama: r.name,
      // Aturan yang tidak dikenal lagi dibaca sebagai bebas: warnanya tetap
      // tampil persis, hanya roda yang tidak lagi menyusunnya ulang.
      aturan: (ATURAN_HARMONI as readonly string[]).includes(r.harmony) ? (r.harmony as AturanHarmoni) : 'CUSTOM',
      warna: warna as string[],
      kain,
      porsi: kain ? (porsiSah ? (porsiMentah as number[]) : PORSI_AWAL[warna.length]) : null,
      dibuatOleh: r.createdBy?.name ?? null,
      dibuatPada: r.createdAt.toISOString(),
    });
  }
  return hasil;
}

/**
 * Seluruh Pantone TCX dari tabel yang sama dengan layar warna produksi,
 * sebagai `[kode, hex, nama]` — bentuk sependek mungkin, karena 2.800 baris
 * ini ikut terkirim ke peramban untuk pencarian dan padanan terdekat.
 */
export async function daftarPantoneTcx(): Promise<[string, string, string][]> {
  const rows = await prisma.pantoneColor.findMany({
    select: { tcx: true, hex: true, name: true },
    orderBy: { tcx: 'asc' },
  });
  return rows.map((r) => [r.tcx, r.hex, r.name]);
}
