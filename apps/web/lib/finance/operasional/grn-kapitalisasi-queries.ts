import type { Prisma, PrismaClient } from "@elorae/db";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { ppnKapitalisasiGrn, type BarisGrnKapitalisasi } from "./grn-kapitalisasi";

type Klien = PrismaClient | Prisma.TransactionClient;

/**
 * Untuk `createGRN` (di dalam transaksinya, SEBELUM stok bergerak): PPN yang
 * dikapitalisasi ke tiap baris GRN saat Elorae bukan PKP. Aturannya murni di
 * `grn-kapitalisasi.ts`. GRN tanpa PO → semua nol.
 */
export async function hitungPpnKapitalisasiGrn(
  client: Klien,
  input: { poId: string | null; baris: readonly BarisGrnKapitalisasi[]; tanggal: Date },
): Promise<number[]> {
  if (!input.poId) return input.baris.map(() => 0);
  const [po, pengaturan] = await Promise.all([
    client.purchaseOrder.findUnique({
      where: { id: input.poId },
      select: { ppnRatePercent: true, items: { select: { itemId: true, variantSku: true, ppnIncluded: true } } },
    }),
    bacaPengaturanPpn(client),
  ]);
  if (!po) return input.baris.map(() => 0);
  return ppnKapitalisasiGrn({
    baris: input.baris,
    barisPo: po.items,
    tarifPo: po.ppnRatePercent == null ? null : Number(po.ppnRatePercent),
    pengaturan,
    tanggal: input.tanggal,
  });
}
