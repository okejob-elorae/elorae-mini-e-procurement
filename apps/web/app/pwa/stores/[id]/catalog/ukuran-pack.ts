import { prisma } from "@elorae/db";
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import { petaUkuranPack, type PetaUkuranPack } from "@/lib/field-sales/keranjang-katalog";

/**
 * Ukuran (dan warna) varian barang jadi aktif untuk tombol "+1 pack" di
 * katalog — dimuat bersama halaman, jadi ikut tersimpan di cache halaman dan
 * tetap jalan tanpa sinyal. Hanya ukuran yang disebut rasio yang dikirim; tanpa
 * rasio tidak ada kueri sama sekali (tombolnya juga tidak tampil).
 */
export async function muatUkuranPack(rasio: PackRatioRow[]): Promise<PetaUkuranPack> {
  if (rasio.length === 0) return {};
  const rows = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD" },
    select: { variants: true },
  });
  return petaUkuranPack(
    rows.map((r) => r.variants),
    rasio,
  );
}
