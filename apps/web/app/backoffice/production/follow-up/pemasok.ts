import { prisma } from "@elorae/db";

/*
 * Pilihan saringan pemasok di Follow-up produksi — server saja (Prisma).
 * Hanya pemasok yang pernah dipasang di langkah jadwal, supaya daftarnya
 * pendek; pemasok yang sedang dipilih di alamat selalu ikut, walau langkahnya
 * sudah tidak ada, supaya saringannya tetap terbaca.
 */

export type PilihanPemasok = { id: string; name: string };

export async function pemasokFollowUp(terpilih: string | null): Promise<PilihanPemasok[]> {
  return prisma.supplier.findMany({
    where: {
      OR: [{ planStageSteps: { some: {} } }, ...(terpilih ? [{ id: terpilih }] : [])],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}
