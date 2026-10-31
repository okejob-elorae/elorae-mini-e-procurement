import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { jumlahPenjualan, type TotalPenjualan } from "./penjualan-aturan";

/*
 * Penjualan afiliasi satu kolaborasi — untuk panel Penjualan di rincian
 * kolaborasi. Angka gabungan lintas kolaborasi (GMV, ROAS) tetap dari
 * `angka-queries.ts`; berkas ini hanya daftar barisnya.
 */

export type BarisPenjualan = {
  id: string;
  /** Hari WIB "YYYY-MM-DD". */
  tanggal: string;
  orders: number;
  gmv: number;
  komisi: number;
  sumber: string | null;
  catatan: string | null;
  pencatat: string | null;
};

export async function penjualanKolaborasi(kolaborasiId: string): Promise<{ baris: BarisPenjualan[]; total: TotalPenjualan }> {
  if (!kolaborasiId) return { baris: [], total: jumlahPenjualan([]) };
  const rows = await prisma.kolSale.findMany({
    where: { collabId: kolaborasiId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { id: true, date: true, orders: true, gmv: true, commission: true, source: true, note: true, createdById: true },
  });
  const pencatatId = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
  const pengguna = pencatatId.length
    ? await prisma.user.findMany({ where: { id: { in: pencatatId } }, select: { id: true, name: true } })
    : [];
  const nama = new Map(pengguna.map((u) => [u.id, u.name]));
  const baris = rows.map((r) => ({
    id: r.id,
    tanggal: formatDateOnlyJakarta(r.date),
    orders: r.orders,
    gmv: Number(r.gmv),
    komisi: Number(r.commission),
    sumber: r.source,
    catatan: r.note,
    pencatat: r.createdById ? (nama.get(r.createdById) ?? null) : null,
  }));
  return { baris, total: jumlahPenjualan(baris.map((b) => ({ orders: b.orders, gmv: b.gmv, commission: b.komisi }))) };
}
