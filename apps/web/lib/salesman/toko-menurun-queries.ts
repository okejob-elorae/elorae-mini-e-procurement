import { tokoMenurun } from "./queries";
import { menurunUntukHp, type TokoMenurun } from "./toko-menurun";

/**
 * Toko menurun untuk BERANDA HP salesman: `tokoMenurun` yang sama, lalu
 * dibentuk ulang oleh `menurunUntukHp` — rupiahnya diganti rasio "turun X%".
 * Toko konsinyasi mendapat rasionya seperti toko lain (P56). Halaman HP
 * memanggil ini, tidak pernah `tokoMenurun` langsung.
 *
 * Client screens hanya boleh `import type` dari berkas ini (memuat Prisma).
 */
export async function tokoMenurunHp(
  toko: readonly { storeId: string; nama: string }[],
  hariIni: Date,
): Promise<TokoMenurun[]> {
  const daftar = await tokoMenurun(toko, hariIni);
  if (daftar.length === 0) return [];
  return menurunUntukHp(daftar);
}
