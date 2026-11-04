import { prisma } from "@elorae/db";

/** Area toko (JGU, JTT, …). Nonaktif tetap dibawa: toko lama mungkin masih menunjuknya. */
export type AreaToko = { id: string; code: string; name: string; isActive: boolean; jumlahToko: number };

export async function daftarArea(): Promise<AreaToko[]> {
  const rows = await prisma.storeGroup.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, isActive: true, _count: { select: { stores: true } } },
  });
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive, jumlahToko: r._count.stores }));
}
