"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { JEJAK_HILANG, validasiAturanBarangHilang } from "@/lib/spg/hilang";
import { bacaBarangHilang, KUNCI_BARANG_HILANG } from "@/lib/spg/pengaturan";

/**
 * Pengaturan → SPG → Barang hilang: dasar nilai per potong, batas potongan dari
 * satu pembayaran gaji/komisi, apakah opname toko konsinyasi yang kurang
 * otomatis membuka catatan. Persen keringanan diskon pegawai tidak disimpan di
 * sini — kantor mengetiknya sendiri di setiap keputusan.
 *
 * Dijaga `receivables:manage` — yang menetapkan beban dan memotongnya. Setiap
 * simpanan meninggalkan satu baris jejak (sebelum/sesudah) DI DALAM transaksi
 * yang sama: baris `SystemSetting` hanya menyimpan aturan terakhir.
 */

export type HasilSimpanBarangHilang = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanBarangHilangSpg(isi: unknown): Promise<HasilSimpanBarangHilang> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) return { ok: false, code: "FORBIDDEN" };

  const aturan = validasiAturanBarangHilang(isi);
  if (!aturan) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(aturan);
  // Yang disimpan harus terbaca kembali persis sama oleh pembaca yang dipakai penulis.
  if (JSON.stringify(bacaBarangHilang(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
    await tx.systemSetting.upsert({
      where: { key: KUNCI_BARANG_HILANG },
      create: { key: KUNCI_BARANG_HILANG, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: JEJAK_HILANG.PENGATURAN_DIUBAH,
        entityType: "SystemSetting",
        entityId: KUNCI_BARANG_HILANG,
        changes: { before: bacaBarangHilang(lama?.value), after: aturan },
      },
    });
  });

  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/backoffice/barang-hilang");
  return { ok: true };
}
