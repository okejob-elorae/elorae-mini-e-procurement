"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaTutupHari, KUNCI_TUTUP_HARI, type AturanTutupHari } from "@/lib/spg/pengaturan";
import { JEJAK_TUTUP_HARI } from "@/lib/spg/tutup-hari";

/**
 * Pengaturan → SPG → Tutup hari: isian mana yang ditanyakan ke SPG
 * (pengunjung, total kasir) dan apakah foto wajib. Disimpan sebagai JSON di
 * `spg.tutupHari`, dibaca lewat `bacaTutupHari` — nilai yang disimpan harus
 * terbaca kembali persis sama.
 *
 * Dijaga `stores:manage` (pengelola toko memutuskan kerja di konter). Setiap
 * perubahan meninggalkan jejak sebelum/sesudah di transaksi yang sama.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanTutupHari(isi: AturanTutupHari): Promise<Hasil> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  if (
    !isi ||
    typeof isi.tanyaPengunjung !== "boolean" ||
    typeof isi.tanyaTotalKasir !== "boolean" ||
    typeof isi.wajibFoto !== "boolean"
  ) {
    return { ok: false, code: "INVALID" };
  }
  const aturan: AturanTutupHari = { tanyaPengunjung: isi.tanyaPengunjung, tanyaTotalKasir: isi.tanyaTotalKasir, wajibFoto: isi.wajibFoto };
  const nilai = JSON.stringify(aturan);
  if (JSON.stringify(bacaTutupHari(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_TUTUP_HARI }, select: { value: true } });
    const sebelum = bacaTutupHari(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_TUTUP_HARI },
      create: { key: KUNCI_TUTUP_HARI, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_TUTUP_HARI.PENGATURAN,
        entityType: "SystemSetting",
        entityId: KUNCI_TUTUP_HARI,
        changes: { before: sebelum, after: aturan } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/pwa/spg/tutup");
  return { ok: true };
}
