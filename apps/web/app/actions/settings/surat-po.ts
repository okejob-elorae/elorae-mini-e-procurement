"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { JEJAK_SURAT_PO, KUNCI_SURAT_PO, bacaSuratPo, periksaSuratPo, type SuratPo } from "@/lib/purchase-orders/surat-po";

/**
 * Pengaturan → Pajak → Surat PO: paragraf pembuka dan penutup bawaan cetak PO
 * (`purchasing.suratPo`). Dibaca oleh siapa pun yang boleh melihat PO (dialog
 * cetak mengisinya lebih dulu) atau pengaturan pajak; diubah dengan izin yang
 * sama dengan tarif PPN (`settings_tax:manage`). Setiap perubahan meninggalkan
 * jejak sebelum/sesudah di transaksi yang sama.
 */

export async function ambilSuratPo(): Promise<{ ok: true; surat: SuratPo } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW) && !hasPermission(izin, PERMISSIONS.SETTINGS_TAX_VIEW)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_SURAT_PO }, select: { value: true } });
  return { ok: true, surat: bacaSuratPo(baris?.value ?? null) };
}

export async function simpanSuratPo(isi: SuratPo): Promise<{ ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_TAX_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  const surat = periksaSuratPo(isi);
  if (!surat) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(surat);

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_SURAT_PO }, select: { value: true } });
    const sebelum = bacaSuratPo(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_SURAT_PO },
      create: { key: KUNCI_SURAT_PO, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_SURAT_PO,
        entityType: "SystemSetting",
        entityId: KUNCI_SURAT_PO,
        changes: { before: sebelum, after: surat } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/tax");
  return { ok: true };
}
