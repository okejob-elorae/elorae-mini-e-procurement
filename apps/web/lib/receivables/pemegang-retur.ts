import type { prisma, Prisma } from "@elorae/db";
import { pemegangPada } from "@/lib/salesman/penjualan-konsi";
import { riwayatPemegang } from "@/lib/stores/riwayat-pemegang";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Sales pemegang toko PADA TANGGAL nota retur toko dibuat (P85, jawaban pemilik
 * 2026-11-02 "setuju"): selisih retur ditanggung pemegang saat retur itu,
 * bukan pemegang sekarang. Dibaca mundur dari jejak pindah pemegang dengan
 * aturan yang sama dengan omzet konsinyasi (`pemegangPada`). `null` = toko tanpa
 * pemegang saat itu, atau notanya tidak ada.
 */
export async function pemegangSaatRetur(klien: Klien, storeReturnId: string): Promise<string | null> {
  const nota = await klien.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: { claimDate: true, storeId: true, store: { select: { salesmanId: true } } },
  });
  if (!nota) return null;
  const riwayat = (await riwayatPemegang(klien, [nota.storeId])).get(nota.storeId) ?? [];
  return pemegangPada(riwayat, nota.store.salesmanId, nota.claimDate);
}
