import { prisma } from '@elorae/db';
import { KUNCI_PEMETAAN_WARNA, bacaPemetaan, ubahPemetaan, type AlasanPemetaanTidakSah, type PemetaanWarna } from './pemetaan-warna';
import { KUNCI_TINTA_DASAR, periksaTintaDasar, type AlasanTintaTidakSah, type TintaDasar } from './tinta-dasar';

/** Ganti seluruh daftar tinta dasar tim. Isinya diperiksa ulang di sini, bukan dipercayakan pada layar. */
export async function simpanTintaDasar(
  masukan: unknown,
): Promise<{ ok: true; tinta: TintaDasar[] } | { ok: false; alasan: AlasanTintaTidakSah }> {
  const periksa = periksaTintaDasar(masukan);
  if (!periksa.ok) return periksa;
  const value = JSON.stringify(periksa.tinta);
  await prisma.systemSetting.upsert({
    where: { key: KUNCI_TINTA_DASAR },
    create: { key: KUNCI_TINTA_DASAR, value },
    update: { value },
  });
  return periksa;
}

/**
 * Petakan (atau hapus, `hex` null) satu nama warna varian. Dibaca dan ditulis
 * dalam satu transaksi supaya dua orang yang memetakan bersamaan tidak saling
 * menghapus entri.
 */
export async function simpanPemetaanWarna(
  nama: unknown,
  hex: unknown,
): Promise<{ ok: true; peta: PemetaanWarna } | { ok: false; alasan: AlasanPemetaanTidakSah }> {
  return prisma.$transaction(async (tx) => {
    const baris = await tx.systemSetting.findUnique({ where: { key: KUNCI_PEMETAAN_WARNA }, select: { value: true } });
    const hasil = ubahPemetaan(bacaPemetaan(baris?.value ?? null), nama, hex);
    if (!hasil.ok) return hasil;
    const value = JSON.stringify(hasil.peta);
    await tx.systemSetting.upsert({ where: { key: KUNCI_PEMETAAN_WARNA }, create: { key: KUNCI_PEMETAAN_WARNA, value }, update: { value } });
    return hasil;
  });
}
