import { prisma } from "@elorae/db";
import { samarkanHp } from "./pelanggan";
import { STATUS_TITIP_TERBUKA } from "./titip";

/**
 * Data pembeli untuk layar kantor (`/backoffice/spg-pelanggan`, `spg_sales:view`).
 *
 * Nomor HP pembeli TIDAK PERNAH keluar dari sini utuh — selalu disamarkan
 * (`0812****7890`). Kantor cukup bisa melihat seberapa banyak pembeli tiap
 * toko dan seberapa sering mereka kembali; yang menghubungi pembeli adalah
 * SPG tokonya, dari HP-nya.
 *
 * Total belanja = nilai nota sesudah potongan, dikurangi barang yang sudah
 * dikembalikan pembeli (harga bersih per potong, seperti dasbor).
 */

export type RingkasPelangganToko = {
  storeId: string;
  toko: string;
  kode: string;
  jumlahPelanggan: number;
  jumlahNota: number;
  belanjaTerakhir: string | null;
  totalBelanja: number;
};

/** Nilai potong yang dikembalikan, per nota: `returnedQty × lineTotal/qty` (baris lama: unitPrice). */
function nilaiKembali(l: { qty: number; returnedQty: number; unitPrice: unknown; lineTotal: unknown }): number {
  const harga = l.qty > 0 ? Number(l.lineTotal) / l.qty : Number(l.unitPrice);
  return l.returnedQty * (Number.isFinite(harga) ? harga : 0);
}

const bulat = (n: number) => Math.round(n * 100) / 100;

async function nilaiKembaliPer(kunci: "storeId" | "customerId", where: { storeId?: string }): Promise<Map<string, number>> {
  const baris = await prisma.spgSaleLine.findMany({
    where: { returnedQty: { gt: 0 }, spgSale: { customerId: { not: null }, ...where } },
    select: { qty: true, returnedQty: true, unitPrice: true, lineTotal: true, spgSale: { select: { storeId: true, customerId: true } } },
  });
  const m = new Map<string, number>();
  for (const l of baris) {
    const k = kunci === "storeId" ? l.spgSale.storeId : (l.spgSale.customerId as string);
    m.set(k, (m.get(k) ?? 0) + nilaiKembali(l));
  }
  return m;
}

/** Satu baris per toko yang punya pelanggan tercatat, terbanyak dulu. */
export async function ringkasPelangganKantor(): Promise<RingkasPelangganToko[]> {
  const [pelanggan, nota, kembali] = await Promise.all([
    prisma.storeCustomer.groupBy({ by: ["storeId"], _count: { _all: true } }),
    prisma.spgSale.groupBy({ by: ["storeId"], where: { customerId: { not: null } }, _count: { _all: true }, _sum: { total: true }, _max: { createdAt: true } }),
    nilaiKembaliPer("storeId", {}),
  ]);
  const storeIds = [...new Set(pelanggan.map((p) => p.storeId))];
  if (storeIds.length === 0) return [];
  const toko = await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, code: true } });
  const tokoPer = new Map(toko.map((t) => [t.id, t]));
  const notaPer = new Map(nota.map((n) => [n.storeId, n]));
  return pelanggan
    .map((p) => {
      const n = notaPer.get(p.storeId);
      const t = tokoPer.get(p.storeId);
      return {
        storeId: p.storeId,
        toko: t?.name ?? "—",
        kode: t?.code ?? "",
        jumlahPelanggan: p._count._all,
        jumlahNota: n?._count._all ?? 0,
        belanjaTerakhir: n?._max.createdAt ? n._max.createdAt.toISOString() : null,
        totalBelanja: Math.max(0, bulat(Number(n?._sum.total ?? 0) - (kembali.get(p.storeId) ?? 0))),
      };
    })
    .sort((a, b) => b.jumlahPelanggan - a.jumlahPelanggan || a.toko.localeCompare(b.toko));
}

export type PelangganKantor = {
  id: string;
  nama: string;
  /** SELALU disamarkan. */
  hpSamar: string;
  dicatat: string;
  jumlahNota: number;
  belanjaTerakhir: string | null;
  totalBelanja: number;
  titipTerbuka: number;
};

export const BATAS_PELANGGAN_KANTOR = 500;

/** Pelanggan satu toko untuk kantor, nomor HP disamarkan. */
export async function pelangganTokoKantor(storeId: string): Promise<{ toko: { id: string; name: string; code: string } | null; baris: PelangganKantor[]; total: number }> {
  const [toko, rows, total] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, code: true } }),
    prisma.storeCustomer.findMany({
      where: { storeId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: BATAS_PELANGGAN_KANTOR,
      select: { id: true, name: true, phone: true, createdAt: true },
    }),
    prisma.storeCustomer.count({ where: { storeId } }),
  ]);
  const ids = rows.map((r) => r.id);
  const [nota, titip, kembali] = ids.length
    ? await Promise.all([
        prisma.spgSale.groupBy({
          by: ["customerId"],
          where: { storeId, customerId: { in: ids } },
          _count: { _all: true },
          _sum: { total: true },
          _max: { createdAt: true },
        }),
        prisma.customerRequest.groupBy({
          by: ["customerId"],
          where: { storeId, customerId: { in: ids }, status: { in: [...STATUS_TITIP_TERBUKA] } },
          _count: { _all: true },
        }),
        nilaiKembaliPer("customerId", { storeId }),
      ])
    : [[], [], new Map<string, number>()];
  const notaPer = new Map(nota.map((n) => [n.customerId, n]));
  const titipPer = new Map(titip.map((t) => [t.customerId, t._count._all]));
  return {
    toko,
    total,
    baris: rows.map((r) => {
      const n = notaPer.get(r.id);
      return {
        id: r.id,
        nama: r.name,
        hpSamar: samarkanHp(r.phone),
        dicatat: r.createdAt.toISOString(),
        jumlahNota: n?._count._all ?? 0,
        belanjaTerakhir: n?._max.createdAt ? n._max.createdAt.toISOString() : null,
        totalBelanja: Math.max(0, bulat(Number(n?._sum.total ?? 0) - (kembali.get(r.id) ?? 0))),
        titipTerbuka: titipPer.get(r.id) ?? 0,
      };
    }),
  };
}
