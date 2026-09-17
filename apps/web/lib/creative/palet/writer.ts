import { prisma } from '@elorae/db';
import { periksaPalet, type AlasanPaletTidakSah } from './validasi';

export type AlasanGagalPalet = AlasanPaletTidakSah | 'TIDAK_DITEMUKAN';

export async function simpanPalet(input: {
  masukan: { nama: unknown; aturan: unknown; warna: unknown; kain?: unknown; porsi?: unknown };
  olehUserId: string;
}): Promise<{ ok: true; id: string } | { ok: false; alasan: AlasanGagalPalet }> {
  const periksa = periksaPalet(input.masukan);
  if (!periksa.ok) return periksa;

  const palet = await prisma.colorPalette.create({
    data: {
      name: periksa.isi.nama,
      harmony: periksa.isi.aturan,
      colors: periksa.isi.warna,
      fabricHex: periksa.isi.kain,
      // `undefined`, bukan `null`: kolom JSON Prisma membedakan "tidak diisi"
      // dari JSON null, dan palet bebas memang tidak punya porsi.
      portions: periksa.isi.porsi ?? undefined,
      createdById: input.olehUserId,
    },
    select: { id: true },
  });
  return { ok: true, id: palet.id };
}

/**
 * Palet bukan dokumen keuangan dan tidak dirujuk baris lain, jadi dihapus
 * sungguhan. `deleteMany` dengan id yang pasti ada nilainya: hasil hitungnya
 * yang membedakan "sudah dihapus orang lain" dari berhasil.
 */
export async function hapusPalet(id: string): Promise<{ ok: true } | { ok: false; alasan: AlasanGagalPalet }> {
  if (typeof id !== 'string' || !id) return { ok: false, alasan: 'TIDAK_DITEMUKAN' };
  const { count } = await prisma.colorPalette.deleteMany({ where: { id } });
  return count === 1 ? { ok: true } : { ok: false, alasan: 'TIDAK_DITEMUKAN' };
}
