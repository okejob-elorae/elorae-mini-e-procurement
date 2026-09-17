import { prisma } from '@elorae/db';
import { ATURAN_HARMONI, JUMLAH_WARNA, type AturanHarmoni } from './harmoni';
import { normalisasiHex } from './warna';

export type BarisPalet = {
  id: string;
  nama: string;
  aturan: AturanHarmoni;
  warna: string[];
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
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });

  const hasil: BarisPalet[] = [];
  for (const r of rows) {
    const warna = Array.isArray(r.colors)
      ? r.colors.map((w) => (typeof w === 'string' ? normalisasiHex(w) : null))
      : [];
    if (warna.length !== JUMLAH_WARNA || warna.some((w) => w === null)) {
      console.warn(`Palet ${r.id} dilewati: kolom colors bukan lima warna.`);
      continue;
    }
    hasil.push({
      id: r.id,
      nama: r.name,
      // Aturan yang tidak dikenal lagi dibaca sebagai bebas: warnanya tetap
      // tampil persis, hanya roda yang tidak lagi menyusunnya ulang.
      aturan: (ATURAN_HARMONI as readonly string[]).includes(r.harmony) ? (r.harmony as AturanHarmoni) : 'CUSTOM',
      warna: warna as string[],
      dibuatOleh: r.createdBy?.name ?? null,
      dibuatPada: r.createdAt.toISOString(),
    });
  }
  return hasil;
}
