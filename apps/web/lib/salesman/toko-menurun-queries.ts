import { prisma } from "@elorae/db";
import { tokoMenurun } from "./queries";
import { HARI_JENDELA_NILAI, menurunUntukHp, type TokoMenurun } from "./toko-menurun";

const HARI_MS = 86_400_000;

/**
 * Toko menurun untuk BERANDA HP salesman: `tokoMenurun` yang sama, lalu
 * dibentuk ulang oleh `menurunUntukHp` — tanpa rupiah. Nilai 90 hari per toko
 * adalah total pesanan toko itu, dan di toko konsinyasi itu total konsi.
 * Halaman HP memanggil ini, tidak pernah `tokoMenurun` langsung (dijaga
 * `penjualan-hp.penjaga.test.ts`).
 *
 * Toko yang punya pesanan KONSI disetujui di dua jendela nilai (180 hari)
 * tidak mendapat rasio: rasio total yang memuat konsi membukanya begitu
 * jendela lainnya berisi rupiah yang salesman ketahui (van, putus). Batasnya
 * satu hari lebih lebar dari jendela — lebih baik satu toko kehilangan angka
 * "turun X%" daripada satu total konsi terbuka.
 *
 * Client screens hanya boleh `import type` dari berkas ini (memuat Prisma).
 */
export async function tokoMenurunHp(
  toko: readonly { storeId: string; nama: string }[],
  hariIni: Date,
): Promise<TokoMenurun[]> {
  const daftar = await tokoMenurun(toko, hariIni);
  if (daftar.length === 0) return [];
  const sejak = new Date(hariIni.getTime() - (2 * HARI_JENDELA_NILAI + 1) * HARI_MS);
  const konsi = await prisma.fieldSalesOrder.findMany({
    where: {
      storeId: { in: daftar.map((m) => m.storeId) },
      orderType: "KONSI",
      status: "APPROVED",
      approvedAt: { gte: sejak },
    },
    select: { storeId: true },
    distinct: ["storeId"],
  });
  return menurunUntukHp(daftar, { tokoKonsi: new Set(konsi.map((k) => k.storeId)) });
}
