// Bukan aksi server — KHUSUS SERVER (membaca basis data lewat klien yang diberikan).
// Komponen klien hanya boleh `import type` dari berkas ini; nilainya di `./hpp-barang.ts`.

import type { Prisma, PrismaClient } from "@elorae/db";
import { hitungHppBarang, type HppBarang } from "./hpp-barang";

type Klien = Prisma.TransactionClient | PrismaClient;

/**
 * HPP per pcs barang jadi untuk formulir barang (lihat `./hpp-barang.ts`).
 *
 * Penerimaan yang menjadi rincian (dan dasar bila stok 0) = penerimaan
 * terakhir barang ini yang punya pcs lolos DAN memikul bahan. Setoran yang
 * semuanya cacat tidak punya pcs; lebih produksi sesudah WO lengkap tidak
 * memikul bahan (seluruhnya sudah dipikul penerimaan sebelumnya), jadi
 * rinciannya akan menunjukkan bahan 0 — bukan gambaran biaya barang itu.
 * Penerimaan lama tanpa kolom bahan dihitung dari nilainya.
 */
export async function bacaHppBarang(klien: Klien, itemId: string): Promise<HppBarang> {
  const [stok, terakhir] = await Promise.all([
    klien.inventoryValue.findMany({
      where: { itemId, qtyOnHand: { gt: 0 } },
      select: { qtyOnHand: true, totalValue: true },
    }),
    klien.fGReceipt.findFirst({
      where: {
        wo: { finishedGoodId: itemId },
        qtyAccepted: { gt: 0 },
        OR: [{ materialCost: { gt: 0 } }, { materialCost: null, totalCostValue: { gt: 0 } }],
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: {
        docNumber: true,
        receivedAt: true,
        qtyAccepted: true,
        materialCost: true,
        serviceCost: true,
        additionalCost: true,
        totalCostValue: true,
        wo: { select: { docNumber: true } },
      },
    }),
  ]);
  return hitungHppBarang(
    stok,
    terakhir ? { ...terakhir, woDocNumber: terakhir.wo.docNumber } : null,
  );
}
