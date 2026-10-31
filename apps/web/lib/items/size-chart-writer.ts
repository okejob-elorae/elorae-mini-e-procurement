import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import {
  ENTITAS_TABEL_UKURAN,
  JEJAK_TABEL_UKURAN,
  periksaTabelUkuran,
  type IsianTabelUkuran,
  type MasalahTabelUkuran,
  type TabelUkuranSah,
} from "./size-chart";

/**
 * Penulis master tabel ukuran. Setiap simpan/hapus menulis jejaknya
 * (`AuditLog`, sebelum/sesudah) DI DALAM transaksi yang sama.
 *
 * Aturan "satu tabel AKTIF per kategori" dijaga di sini, bukan oleh indeks
 * unik (kolom `categoryId` boleh berulang untuk tabel nonaktif): periksa lalu
 * tulis di dalam `runSerializable`, jadi dua simpan bersamaan untuk kategori
 * yang sama tidak bisa sama-sama lolos — yang kalah diulang dan menemukan
 * tabel pertama.
 */

export type HasilSimpanTabelUkuran =
  | { ok: true; id: string }
  | { ok: false; code: "TIDAK_SAH"; masalah: MasalahTabelUkuran[] }
  | { ok: false; code: "TIDAK_DITEMUKAN" | "KATEGORI_TIDAK_DITEMUKAN" }
  | { ok: false; code: "DUPLIKAT_KATEGORI"; namaBentrok: string };

export type HasilHapusTabelUkuran =
  | { ok: true }
  | { ok: false; code: "TIDAK_DITEMUKAN" }
  | { ok: false; code: "DIPAKAI"; jumlah: number };

type BarisTabel = {
  id: string;
  name: string;
  unit: string;
  categoryId: string | null;
  columns: Prisma.JsonValue;
  rows: Prisma.JsonValue;
  note: string | null;
  isActive: boolean;
};

const keJejak = (r: BarisTabel | TabelUkuranSah) => ({
  name: r.name,
  unit: r.unit,
  categoryId: r.categoryId,
  columns: r.columns,
  rows: r.rows,
  note: r.note,
  isActive: r.isActive,
});

export async function simpanTabelUkuran(input: {
  /** Kosong = buat baru. */
  id?: string | null;
  isian: IsianTabelUkuran;
  userId: string;
}): Promise<HasilSimpanTabelUkuran> {
  const periksa = periksaTabelUkuran(input.isian);
  if (!periksa.ok) return { ok: false, code: "TIDAK_SAH", masalah: periksa.masalah };
  const data = periksa.data;

  return runSerializable(async (tx): Promise<HasilSimpanTabelUkuran> => {
    const lama = input.id ? await tx.sizeChart.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !lama) return { ok: false, code: "TIDAK_DITEMUKAN" };

    if (data.categoryId) {
      const kategori = await tx.itemCategory.findUnique({ where: { id: data.categoryId }, select: { id: true } });
      if (!kategori) return { ok: false, code: "KATEGORI_TIDAK_DITEMUKAN" };
      if (data.isActive) {
        const bentrok = await tx.sizeChart.findFirst({
          where: { categoryId: data.categoryId, isActive: true, ...(input.id ? { id: { not: input.id } } : {}) },
          select: { name: true },
        });
        if (bentrok) return { ok: false, code: "DUPLIKAT_KATEGORI", namaBentrok: bentrok.name };
      }
    }

    const nilai = {
      name: data.name,
      unit: data.unit,
      categoryId: data.categoryId,
      columns: data.columns,
      rows: data.rows,
      note: data.note,
      isActive: data.isActive,
    };
    const baris = lama
      ? await tx.sizeChart.update({ where: { id: lama.id }, data: nilai })
      : await tx.sizeChart.create({ data: nilai });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: lama ? JEJAK_TABEL_UKURAN.DIUBAH : JEJAK_TABEL_UKURAN.DIBUAT,
        entityType: ENTITAS_TABEL_UKURAN,
        entityId: baris.id,
        changes: { before: lama ? keJejak(lama) : null, after: keJejak(data) } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, id: baris.id };
  });
}

/**
 * Hapus tabel ukuran. Ditolak selama masih ada barang yang memasangnya
 * langsung — nonaktifkan saja. Tabel yang hanya menjadi bawaan kategori boleh
 * dihapus: barangnya jatuh ke "tanpa tabel", tidak ada penunjuk yang menggantung.
 */
export async function hapusTabelUkuran(input: { id: string; userId: string }): Promise<HasilHapusTabelUkuran> {
  return runSerializable(async (tx): Promise<HasilHapusTabelUkuran> => {
    const lama = await tx.sizeChart.findUnique({ where: { id: input.id } });
    if (!lama) return { ok: false, code: "TIDAK_DITEMUKAN" };
    const jumlah = await tx.item.count({ where: { sizeChartId: lama.id } });
    if (jumlah > 0) return { ok: false, code: "DIPAKAI", jumlah };
    await tx.sizeChart.delete({ where: { id: lama.id } });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_TABEL_UKURAN.DIHAPUS,
        entityType: ENTITAS_TABEL_UKURAN,
        entityId: lama.id,
        changes: { before: keJejak(lama), after: null } as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  });
}
