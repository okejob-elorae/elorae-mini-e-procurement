"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaDiskonManual, KUNCI_DISKON_MANUAL, type AturanDiskonManualSpg } from "@/lib/spg/pengaturan";
import { JEJAK_PROMO_KONTER, sahkanDiskonManual } from "@/lib/spg/promo-konter-kantor";

/**
 * Diskon manual SPG di konter (`spg.diskonManual`): nyala/mati, batas persen
 * per nota, alasan wajib. Dijaga `promos:manage` — yang memutuskan promo yang
 * memutuskan potongan tangan. Menyalakan diskon manual membuka kas toko untuk
 * potongan tanpa promo, jadi setiap perubahan meninggalkan jejak `AuditLog`
 * dengan sebelum/sesudah di transaksi yang sama.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanDiskonManualSpg(isi: AturanDiskonManualSpg): Promise<Hasil> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  const aturan = sahkanDiskonManual(isi);
  if (!aturan) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(aturan);

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL }, select: { value: true } });
    const before = bacaDiskonManual(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_DISKON_MANUAL },
      create: { key: KUNCI_DISKON_MANUAL, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_PROMO_KONTER.DISKON_MANUAL_DIATUR,
        entityType: "SystemSetting",
        entityId: KUNCI_DISKON_MANUAL,
        changes: { before, after: aturan } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/pwa/spg/sale");
  return { ok: true };
}
