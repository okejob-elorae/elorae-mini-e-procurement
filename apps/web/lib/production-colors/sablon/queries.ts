import { prisma } from '@elorae/db';
import { KUNCI_PEMETAAN_WARNA, bacaPemetaan, type PemetaanWarna } from './pemetaan-warna';
import { KUNCI_TINTA_DASAR, bacaTintaDasar, type TintaDasar } from './tinta-dasar';
import type { BarisPenjualanWarna } from './warna-laris';

export async function ambilTintaDasar(): Promise<TintaDasar[]> {
  const baris = await prisma.systemSetting.findUnique({
    where: { key: KUNCI_TINTA_DASAR },
    select: { value: true },
  });
  return bacaTintaDasar(baris?.value ?? null);
}

const HARI = 24 * 60 * 60 * 1000;

/**
 * Terjual bersih per nama warna varian dan kategori produk: 90 hari terakhir
 * dan 90 hari sebelumnya. Hanya pesanan selesai; diolah lebih lanjut oleh
 * `hitungWarnaLaris`.
 */
export async function ambilPenjualanWarna(sekarang: Date = new Date(), hari = 90): Promise<BarisPenjualanWarna[]> {
  const batasKini = new Date(sekarang.getTime() - hari * HARI);
  const batasLalu = new Date(sekarang.getTime() - 2 * hari * HARI);
  const kelompok = (dari: Date, sampai: Date) =>
    prisma.salesHistory.groupBy({
      by: ['color', 'productCategory'],
      where: { orderStatus: 'COMPLETED', orderDate: { gte: dari, lt: sampai }, color: { not: null } },
      _sum: { netQuantity: true },
    });
  const [kini, lalu] = await Promise.all([kelompok(batasKini, sekarang), kelompok(batasLalu, batasKini)]);

  const peta = new Map<string, BarisPenjualanWarna>();
  const ambil = (nama: string | null, kategori: string | null) => {
    const k = JSON.stringify([nama, kategori]);
    let b = peta.get(k);
    if (!b) {
      b = { nama, kategori, kini: 0, lalu: 0 };
      peta.set(k, b);
    }
    return b;
  };
  for (const r of kini) ambil(r.color, r.productCategory).kini += r._sum.netQuantity ?? 0;
  for (const r of lalu) ambil(r.color, r.productCategory).lalu += r._sum.netQuantity ?? 0;
  return [...peta.values()];
}

export async function ambilPemetaanWarna(): Promise<PemetaanWarna> {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PEMETAAN_WARNA }, select: { value: true } });
  return bacaPemetaan(baris?.value ?? null);
}
