import { prisma } from '@elorae/db';
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
