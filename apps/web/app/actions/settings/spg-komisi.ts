"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { JEJAK_KOMISI_SPG, validasiAturanKomisiPutus } from "@/lib/spg/komisi";
import { bacaKomisiPutus, KUNCI_KOMISI_PUTUS } from "@/lib/spg/pengaturan";

/**
 * Pengaturan → SPG → Komisi SPG toko putus: saklar dan dasar pembagiannya.
 *
 * Dijaga `receivables:manage` — keuangan yang menetapkan dan membayar komisi
 * itu. Setiap simpanan meninggalkan satu baris `AuditLog` (sebelum/sesudah)
 * DI DALAM transaksi yang sama: baris `SystemSetting` hanya menyimpan aturan
 * terakhir, jadi jejak itulah yang menjelaskan kenapa bulan lalu dibagi lain.
 */

export type HasilSimpanKomisiPutus = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanKomisiPutusSpg(isi: unknown): Promise<HasilSimpanKomisiPutus> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) return { ok: false, code: "FORBIDDEN" };

  const aturan = validasiAturanKomisiPutus(isi);
  if (!aturan) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(aturan);
  // Yang disimpan harus terbaca kembali persis sama oleh pembaca yang dipakai
  // HP, kantor, dan penulis — kalau tidak, kartu ini menampilkan aturan yang bukan aturan berlaku.
  if (JSON.stringify(bacaKomisiPutus(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_KOMISI_PUTUS }, select: { value: true } });
    await tx.systemSetting.upsert({
      where: { key: KUNCI_KOMISI_PUTUS },
      create: { key: KUNCI_KOMISI_PUTUS, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: JEJAK_KOMISI_SPG.PENGATURAN_DIUBAH,
        entityType: "SystemSetting",
        entityId: KUNCI_KOMISI_PUTUS,
        changes: { before: bacaKomisiPutus(lama?.value), after: aturan },
      },
    });
  });

  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa");
  return { ok: true };
}
