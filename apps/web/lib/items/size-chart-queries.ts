import { prisma } from "@elorae/db";
import { bacaTabelUkuran, type BarisUkuran, type SatuanUkuran, SATUAN_UKURAN } from "./size-chart";

/**
 * Kueri master tabel ukuran (kantor). Hanya untuk server; bentuk hasilnya
 * data polos supaya bisa dikirim ke komponen klien.
 */

export type BarisDaftarTabelUkuran = {
  id: string;
  name: string;
  unit: SatuanUkuran;
  categoryId: string | null;
  categoryName: string | null;
  columns: string[];
  rows: BarisUkuran[];
  note: string | null;
  isActive: boolean;
  /** Barang yang memasang tabel ini langsung (`Item.sizeChartId`). */
  dipakaiBarang: number;
  updatedAtIso: string;
};

const satuan = (u: string): SatuanUkuran => ((SATUAN_UKURAN as readonly string[]).includes(u) ? (u as SatuanUkuran) : "cm");

export async function daftarTabelUkuran(): Promise<BarisDaftarTabelUkuran[]> {
  const rows = await prisma.sizeChart.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  if (rows.length === 0) return [];
  const [kategori, pakai] = await Promise.all([
    prisma.itemCategory.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.categoryId).filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    }),
    prisma.item.groupBy({ by: ["sizeChartId"], where: { sizeChartId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
  ]);
  const namaKategori = new Map(kategori.map((k) => [k.id, k.name]));
  const jumlahPakai = new Map(pakai.map((p) => [p.sizeChartId ?? "", p._count._all]));
  return rows.map((r) => {
    const t = bacaTabelUkuran(r.columns, r.rows);
    return {
      id: r.id,
      name: r.name,
      unit: satuan(r.unit),
      categoryId: r.categoryId,
      categoryName: r.categoryId ? (namaKategori.get(r.categoryId) ?? null) : null,
      columns: t.columns,
      rows: t.rows,
      note: r.note,
      isActive: r.isActive,
      dipakaiBarang: jumlahPakai.get(r.id) ?? 0,
      updatedAtIso: r.updatedAt.toISOString(),
    };
  });
}

export type KategoriTabelUkuran = { id: string; name: string; code: string | null; isActive: boolean };

/**
 * Kategori untuk pilihan "bawaan kategori": yang aktif, ditambah kategori
 * nonaktif yang masih dipakai salah satu tabel (supaya tetap terbaca).
 */
export async function kategoriUntukTabelUkuran(): Promise<KategoriTabelUkuran[]> {
  const dipakai = await prisma.sizeChart.findMany({ where: { categoryId: { not: null } }, select: { categoryId: true } });
  const ids = [...new Set(dipakai.map((d) => d.categoryId).filter((x): x is string => !!x))];
  return prisma.itemCategory.findMany({
    where: ids.length ? { OR: [{ isActive: true }, { id: { in: ids } }] } : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, isActive: true },
  });
}

export type PilihanTabelUkuran ={ id: string; name: string; categoryId: string | null; isActive: boolean };

/**
 * Pilihan tabel ukuran di formulir barang: semua tabel AKTIF, ditambah
 * `sertakanId` (tabel yang sedang terpasang di barang itu) walau nonaktif —
 * supaya pilihannya tetap terbaca dan tidak tergantikan diam-diam.
 */
export async function pilihanTabelUkuran(sertakanId?: string | null): Promise<PilihanTabelUkuran[]> {
  return prisma.sizeChart.findMany({
    where: sertakanId ? { OR: [{ isActive: true }, { id: sertakanId }] } : { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, categoryId: true, isActive: true },
  });
}
